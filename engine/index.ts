import { hostname } from "node:os";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ENGINE_ID, ENGINE_EMAIL, enginePassword } from "./config";
import { state } from "../lib/server/singleton";
import { createConnection, type Connection, type SessionMessage } from "../lib/server/connection";
import { isAlive, killLive, withProjectLock, bypassAllowed } from "../lib/server/liveSessions";
import { listDirectories, deleteSessionFile } from "../lib/server/sessions";
import { getAuthStatus, claudeCliInstalled } from "../lib/server/authStatus";
import { getMcpServersCached, addMcpServer, removeMcpServer } from "../lib/server/mcp";
import { startStallDetection } from "../lib/server/stallDetection";
import { HOME, DEFAULT_PROJECT_DIR } from "../lib/server/env";
import { createImageUploader, createMirror, jsonbSafe } from "./mirror";
import { createOutbound, type Publish } from "./outbound";
import { deviceInfo } from "./device";
import { detectCapabilities, engineTags, TASKS_ENABLED, TASK_SLOTS, TASK_GIT_PUSH } from "./capabilities";
import { createTaskRunner } from "./tasks";
import { listCliModels } from "./models";
import type { ClientMessage, HubEnvelope, ServerMessage } from "../lib/shared/ws-protocol";

const SCAN_INTERVAL_MS = 2 * 60 * 1000;
const SYNC_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
// Full transcripts stay on the hub for this long after their last activity (keeps
// the free 500 MB tier sustainable). Older ones keep their sidebar entry and are
// re-mirrored on demand when opened while this device is online.
const HUB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 30_000;
const VIEWER_GC_MS = 60_000;
// A command older than this was sent while the engine was offline; running it
// now (e.g. a "send" from an hour ago) would surprise more than help.
const COMMAND_MAX_AGE_MS = 2 * 60 * 1000;

const VERSION: string = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
});
const images = createImageUploader(supabase);
const mirror = createMirror(supabase, ENGINE_ID, images);
// Coordinator tasks: claimed here, run as ordinary sessions in isolated worktrees.
const taskRunner = createTaskRunner({
  supabase,
  engineId: ENGINE_ID,
  prepareHistory: (project, sessionId) => mirror.syncSession(project, sessionId),
  canRun: () => TASKS_ENABLED && getAuthStatus().state === "ready",
});

// Realtime topics (see the engine_scoped_access migration):
//   presence          who is online; this engine tracks itself here
//   engine:<id>       this engine's output; only it may send, only the owner may read
let presence: RealtimeChannel | null = null;
let outbox: RealtimeChannel | null = null;

const publish: Publish = async (to, msg) => {
  if (!outbox) return;
  const envelope: HubEnvelope = { engine_id: ENGINE_ID, to, msg };
  if (outbox.state === "joined" && (await outbox.send({ type: "broadcast", event: "server", payload: envelope })) === "ok") return;
  const res = await outbox.httpSend("server", envelope);
  if (!res.success) throw new Error(`broadcast failed (${res.status}): ${res.error}`);
};

async function saveEngine(fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("engines").update(fields).eq("id", ENGINE_ID);
  if (error) console.error("engine row update failed:", error.message);
}

// ---------------------------------------------------------------------------
// Viewers: one virtual connection per browser tab (client id), fed by commands.
// ---------------------------------------------------------------------------
type Viewer = { conn: Connection; createdAt: number };
const viewers = new Map<string, Viewer>();

function getViewer(clientId: string): Viewer {
  let viewer = viewers.get(clientId);
  if (!viewer) {
    const out = createOutbound(clientId, publish, images);
    const send = (msg: ServerMessage) => {
      if (msg.type === "login_result" || msg.type === "auth_required") void saveEngine({ claude_auth: msg.authStatus });
      out.send(msg);
    };
    viewer = {
      conn: createConnection({ send, prepareHistory: (project, sessionId) => mirror.syncSession(project, sessionId) }),
      createdAt: Date.now(),
    };
    viewers.set(clientId, viewer);
  }
  return viewer;
}

function dropViewer(clientId: string): void {
  const viewer = viewers.get(clientId);
  if (!viewer) return;
  viewer.conn.close();
  viewers.delete(clientId);
}

// ---------------------------------------------------------------------------
// Session status → every tab (broadcast) and the sessions table (durable).
// ---------------------------------------------------------------------------
const statusOut = createOutbound(null, publish, images);
const lastSessionByProject = new Map<string, string>();
let statusWrites: Promise<void> = Promise.resolve();

function onTabStatus(msg: ServerMessage): void {
  if (msg.type !== "tab_status") return;
  statusOut.send(msg);

  const previous = lastSessionByProject.get(msg.project);
  const entry = state.liveSessions.get(msg.project);
  const fields = {
    status: msg.status,
    unread: msg.unread,
    live: isAlive(msg.project) && entry?.sessionId === msg.sessionId,
    pending_approval: entry ? jsonbSafe([...entry.pendingApprovals.values()][0] ?? null) : null,
  };
  if (msg.sessionId) lastSessionByProject.set(msg.project, msg.sessionId);
  else lastSessionByProject.delete(msg.project);

  statusWrites = statusWrites
    .then(async () => {
      if (previous && previous !== msg.sessionId) {
        await supabase.from("sessions").update({ live: false, status: "idle", pending_approval: null }).eq("id", previous);
      }
      if (!msg.sessionId) return;
      const { data } = await supabase.from("sessions").update(fields).eq("id", msg.sessionId).select("id");
      if (!data?.length) {
        await supabase.from("sessions").upsert(
          { id: msg.sessionId, project_path: msg.project, engine_id: ENGINE_ID, last_message_at: new Date().toISOString(), ...fields },
          { onConflict: "id" }
        );
      }
      if (msg.status === "idle") void mirror.syncSession(msg.project, msg.sessionId);
    })
    .catch((e) => console.error("status write failed:", e.message));
}

// ---------------------------------------------------------------------------
// Engine-level requests (filesystem / CLI config, not tied to a session).
// ---------------------------------------------------------------------------
type EngineMessage = Extract<ClientMessage, { type: "browse_dirs" | "mcp_refresh" | "mcp_add" | "mcp_remove" | "auth_refresh" | "delete_session" }>;
const ENGINE_LEVEL = new Set(["browse_dirs", "mcp_refresh", "mcp_add", "mcp_remove", "auth_refresh", "delete_session"]);

function browse(requestId: string, path = HOME): ServerMessage {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { type: "browse_error", request_id: requestId, message: `Not a directory: ${path}` };
  }
  let names: string[];
  try {
    names = readdirSync(path);
  } catch {
    return { type: "browse_error", request_id: requestId, message: `Cannot read: ${path}` };
  }
  const dirs = names
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(join(path, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: join(path, name) }));
  return { type: "browse_result", request_id: requestId, path, parent: path === HOME ? null : dirname(path), dirs };
}

async function refreshMcp(force: boolean): Promise<void> {
  const data = await getMcpServersCached(force);
  await saveEngine({ mcp: data, mcp_checked_at: new Date().toISOString() });
}

async function handleEngineMessage(clientId: string, msg: EngineMessage): Promise<void> {
  switch (msg.type) {
    case "browse_dirs":
      await publish(clientId, browse(msg.request_id, msg.path));
      break;
    case "mcp_refresh":
      try {
        await refreshMcp(true);
      } catch (e) {
        await publish(clientId, { type: "mcp_error", message: (e as Error).message });
      }
      break;
    case "mcp_add":
    case "mcp_remove":
      try {
        if (msg.type === "mcp_add") await addMcpServer({ name: msg.name, url: msg.url });
        else await removeMcpServer(msg.name);
      } catch (e) {
        await publish(clientId, { type: "mcp_error", message: (e as Error).message });
      }
      await refreshMcp(true);
      break;
    case "auth_refresh":
      await saveEngine({ claude_auth: getAuthStatus() });
      break;
    case "delete_session":
      try {
        const live = state.liveSessions.get(msg.project);
        // Only stop it if THIS session is the one actually running — the project
        // may have moved on to a different, newer live session since.
        if (live && live.sessionId === msg.sessionId) {
          await withProjectLock(msg.project, () => killLive(msg.project));
        }
        deleteSessionFile(msg.project, msg.sessionId);
        await publish(clientId, { type: "session_deleted", request_id: msg.request_id });
      } catch (e) {
        await publish(clientId, { type: "session_delete_error", request_id: msg.request_id, message: (e as Error).message });
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Command inbox
// ---------------------------------------------------------------------------
type CommandRow = { id: string; client_id: string | null; payload: ClientMessage; created_at: string };
const seenCommands = new Set<string>();

async function finishCommand(id: string, status: "done" | "failed", error?: string, redact = false): Promise<void> {
  const fields: Record<string, unknown> = { status, error: error ?? null, finished_at: new Date().toISOString() };
  // One-time login codes must not linger in the database after use.
  if (redact) fields.payload = { type: "login_code", code: "[redacted]" };
  await supabase.from("commands").update(fields).eq("id", id);
}

function runCommand(row: CommandRow): void {
  if (seenCommands.has(row.id)) return;
  seenCommands.add(row.id);
  if (Date.now() - Date.parse(row.created_at) > COMMAND_MAX_AGE_MS) {
    void finishCommand(row.id, "failed", "expired: the engine was offline when this was sent", row.payload?.type === "login_code");
    return;
  }
  const clientId = row.client_id || "unknown";
  const msg = row.payload;
  // Dispatched synchronously, in arrival order — the viewer's own queue relies on it
  // (init must be queued before the user_message that follows it).
  const work = ENGINE_LEVEL.has(msg.type)
    ? handleEngineMessage(clientId, msg as EngineMessage)
    : getViewer(clientId).conn.process(msg as SessionMessage);
  const redact = msg.type === "login_code";
  work.then(
    () => finishCommand(row.id, "done", undefined, redact),
    (e) => finishCommand(row.id, "failed", (e as Error).message, redact)
  );
}

async function drainBacklog(): Promise<void> {
  const { data, error } = await supabase
    .from("commands")
    .select("id, client_id, payload, created_at")
    .eq("engine_id", ENGINE_ID)
    .eq("status", "pending")
    .order("created_at");
  if (error) return console.error("backlog read failed:", error.message);
  for (const row of data as CommandRow[]) runCommand(row);
}

// ---------------------------------------------------------------------------
// Background transcript mirroring (also picks up sessions started outside
// AwayAgent — VS Code, a terminal — so they're readable from anywhere).
// ---------------------------------------------------------------------------
const sameTime = (a: string | null | undefined, b: string) => !!a && Date.parse(a) === Date.parse(b);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scan(): Promise<void> {
  const dirs = listDirectories();
  const { data: known, error: knownError } = await supabase
    .from("sessions")
    .select("id, title, last_message_at, mirrored_mtime")
    .eq("engine_id", ENGINE_ID);
  if (knownError) throw new Error(`read known sessions: ${knownError.message}`);
  const knownById = new Map((known ?? []).map((r) => [r.id as string, r]));

  // Only write sidebar metadata that actually changed.
  const rows = dirs
    .flatMap((d) =>
      d.sessions.map((s) => ({ id: s.sessionId, project_path: d.projectPath, title: jsonbSafe(s.title) as string, engine_id: ENGINE_ID, last_message_at: s.modified }))
    )
    .filter((r) => {
      const k = knownById.get(r.id);
      return !k || k.title !== r.title || !sameTime(k.last_message_at, r.last_message_at);
    });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("sessions").upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`session metadata upsert: ${error.message}`);
  }

  const projects = new Set([DEFAULT_PROJECT_DIR, ...dirs.map((d) => d.projectPath)]);
  await supabase.from("engine_projects").delete().eq("engine_id", ENGINE_ID);
  await supabase.from("engine_projects").insert([...projects].map((project_path) => ({ engine_id: ENGINE_ID, project_path })));

  const due = dirs
    .flatMap((d) => d.sessions.map((s) => ({ project: d.projectPath, ...s })))
    .filter((s) => Date.now() - Date.parse(s.modified) < SYNC_WINDOW_MS && !sameTime(knownById.get(s.sessionId)?.mirrored_mtime, s.modified))
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  if (due.length) console.log(`mirroring ${due.length} session(s)…`);
  for (const s of due) {
    await mirror.syncSession(s.project, s.sessionId);
    // Transcript parsing is synchronous; give live sessions room between files.
    await pause(250);
  }
  if (due.length) console.log("mirror up to date");
}

async function scanLoop(): Promise<void> {
  try {
    await scan();
  } catch (e) {
    console.error("scan failed:", (e as Error).message);
  }
  setTimeout(scanLoop, SCAN_INTERVAL_MS);
}

async function housekeeping(): Promise<void> {
  const commandCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("commands").delete().eq("engine_id", ENGINE_ID).lt("created_at", commandCutoff);

  const transcriptCutoff = new Date(Date.now() - HUB_RETENTION_MS).toISOString();
  const { data: stale } = await supabase
    .from("sessions")
    .select("id")
    .eq("engine_id", ENGINE_ID)
    .eq("live", false)
    .gt("message_count", 0)
    .lt("last_message_at", transcriptCutoff);
  for (const { id } of stale ?? []) {
    await supabase.from("session_events").delete().eq("session_id", id);
    await supabase.from("sessions").update({ message_count: 0, mirrored_mtime: null }).eq("id", id);
  }
  if (stale?.length) console.log(`pruned ${stale.length} transcript(s) older than the hub retention window`);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
async function markAllSessionsIdle(): Promise<void> {
  await supabase
    .from("sessions")
    .update({ live: false, status: "idle", pending_approval: null })
    .eq("engine_id", ENGINE_ID)
    .or("live.eq.true,status.neq.idle");
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} — stopping live sessions and leaving the hub…`);
  setTimeout(() => process.exit(1), 10_000).unref();
  taskRunner.stopAll(); // reported as interrupted on the next start
  await Promise.all([...state.liveSessions.keys()].map((project) => killLive(project)));
  await statusWrites;
  await markAllSessionsIdle();
  await presence?.untrack();
  await supabase.removeAllChannels();
  process.exit(0);
}

async function main(): Promise<void> {
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: ENGINE_EMAIL, password: enginePassword() });
  if (signInError) {
    console.error(`sign-in failed for ${ENGINE_EMAIL}: ${signInError.message}`);
    process.exit(1);
  }
  const { data: member } = await supabase.from("members").select("role").maybeSingle();
  if (!member) {
    console.error(`${ENGINE_EMAIL} is not an AwayAgent member — run \`npm run engine:setup\` again.`);
    process.exit(1);
  }

  // An engine login is bound to the machine it was first registered on: a copied
  // .env.engine + password on another computer must not impersonate this device.
  const device = deviceInfo();
  const { data: existing } = await supabase.from("engines").select("fingerprint").eq("id", ENGINE_ID).maybeSingle();
  if (existing?.fingerprint && existing.fingerprint !== device.fingerprint) {
    console.error(
      `Engine "${ENGINE_ID}" is registered to a different machine (fingerprint ${existing.fingerprint}, this one is ${device.fingerprint}). ` +
        "Run `npm run engine:setup -- --id <new-name>` to register this machine as its own engine."
    );
    process.exit(1);
  }

  const { error: engineError } = await supabase.from("engines").upsert(
    {
      id: ENGINE_ID,
      hostname: hostname(),
      home_dir: HOME,
      default_project: DEFAULT_PROJECT_DIR,
      version: VERSION,
      allow_bypass: bypassAllowed(),
      capabilities: detectCapabilities(),
      models: await listCliModels(),
      tags: engineTags(),
      tasks_enabled: TASKS_ENABLED,
      task_slots: TASK_SLOTS,
      git_push: TASK_GIT_PUSH,
      last_seen_at: new Date().toISOString(),
      ...device,
    },
    { onConflict: "id" }
  );
  if (engineError) {
    console.error("engine registration failed:", engineError.message);
    process.exit(1);
  }
  await markAllSessionsIdle(); // anything marked live is left over from a previous run
  state.allConnections.add(onTabStatus);

  presence = supabase
    .channel("presence", { config: { private: true, presence: { key: `engine:${ENGINE_ID}` } } })
    .on("presence", { event: "leave" }, ({ key }) => {
      if (key.startsWith("client:")) dropViewer(key.slice("client:".length));
    })
    .subscribe(async (status, err) => {
      if (status === "SUBSCRIBED") {
        await presence!.track({ kind: "engine", id: ENGINE_ID, online_at: new Date().toISOString() });
        // Browsers also require a fresh heartbeat to show us online; send one right
        // away on (re)connect, e.g. after waking from sleep.
        void saveEngine({ last_seen_at: new Date().toISOString() });
        console.log(`engine "${ENGINE_ID}" online (${device.device_name}, fingerprint ${device.fingerprint})`);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`presence channel ${status}${err ? `: ${err.message}` : ""} — retrying`);
      }
    });

  outbox = supabase.channel(`engine:${ENGINE_ID}`, { config: { private: true } }).subscribe((status, err) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error(`output channel ${status}${err ? `: ${err.message}` : ""} — retrying`);
    }
  });

  supabase
    .channel(`commands:${ENGINE_ID}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "commands", filter: `engine_id=eq.${ENGINE_ID}` },
      (payload) => runCommand(payload.new as CommandRow)
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") void drainBacklog();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`command channel ${status}${err ? `: ${err.message}` : ""} — retrying`);
      }
    });

  startStallDetection();
  if (!claudeCliInstalled()) {
    console.error(
      "WARNING: the `claude` CLI is not on this device's PATH, so no session can run here. " +
        "Install Claude Code (brew install --cask claude-code), run `claude auth login`, then restart the engine. " +
        "The copy bundled inside the VS Code extension does not count."
    );
  }

  setInterval(() => void saveEngine({ last_seen_at: new Date().toISOString() }), HEARTBEAT_MS);
  setInterval(() => {
    if (!presence) return;
    const present = new Set(Object.keys(presence.presenceState()));
    for (const [clientId, viewer] of viewers) {
      if (Date.now() - viewer.createdAt > VIEWER_GC_MS && !present.has(`client:${clientId}`)) dropViewer(clientId);
    }
  }, VIEWER_GC_MS);
  void housekeeping();
  setInterval(() => void housekeeping(), 60 * 60 * 1000);
  // A CLI update (e.g. brew upgrade) brings new models without an engine restart.
  setInterval(() => void listCliModels().then((models) => models && saveEngine({ models })), 60 * 60 * 1000);

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // The device's Claude login can change outside AwayAgent (terminal, VS Code,
  // the Claude app), so re-check it periodically instead of only at startup.
  let lastAuthState = getAuthStatus().state;
  void saveEngine({ claude_auth: getAuthStatus() });
  setInterval(() => {
    const auth = getAuthStatus();
    void saveEngine({ claude_auth: auth });
    // E.g. the CLI was just installed: the MCP list saved without it is stale.
    if (auth.state !== lastAuthState) {
      lastAuthState = auth.state;
      refreshMcp(true).catch((e) => console.error("MCP check failed:", e.message));
    }
  }, 5 * 60 * 1000);
  refreshMcp(false).catch((e) => console.error("MCP check failed:", e.message));
  if (TASKS_ENABLED) taskRunner.start();
  // Let the hub connection and any immediate reattach go first.
  setTimeout(() => void scanLoop(), 10_000);
}

void main();

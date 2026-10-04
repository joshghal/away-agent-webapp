import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useConnectionStore, type InitIntent } from "@/store/connectionStore";
import { useSessionStore } from "@/store/sessionStore";
import { useChatStore } from "@/store/chatStore";
import { useTabsStore, tabKey } from "@/store/tabsStore";
import { useTabStatusStore } from "@/store/tabStatusStore";
import { useAuthStore } from "@/store/authStore";
import { useMcpStore } from "@/store/mcpStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useEngineStore, isEngineOnline, selectedEngineId } from "@/store/engineStore";
import { refreshSessions, scheduleRefreshSessions } from "./fetchSessions";
import { updateUrlForCurrent } from "./urlSync";
import type { ClientMessage, EngineRow, HistoryItem, HubEnvelope, ServerMessage } from "@/lib/shared/ws-protocol";

// The browser never talks to a device directly. Requests go into the `commands`
// table (addressed to one engine), replies come back over that engine's private
// Realtime channel, and transcripts are read from `session_events` — which is
// what keeps everything browsable when no device is online.

export const clientId: string =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// "presence" says which engines/tabs are online; each engine's output arrives on
// its own private "engine:<id>" topic that only it can send to (see the
// engine_scoped_access migration).
let presenceCh: RealtimeChannel | null = null;
const engineChannels = new Map<string, RealtimeChannel>();
let started = false;
let connectedEngine: string | null = null;
// Session the engine refused to resume because another app is writing it; shown read-only.
let busySessionId: string | null = null;

// ---------------------------------------------------------------------------
// Routing: which engine handles a given project/session
// ---------------------------------------------------------------------------
function sessionOwner(sessionId: string): string | null {
  for (const dir of useSidebarStore.getState().directories) {
    const hit = dir.sessions.find((s) => s.sessionId === sessionId);
    if (hit) return hit.engineId ?? null;
  }
  return null;
}

// A session can only run on the device that holds its transcript; new sessions
// go to the selected (last-used / any online) device.
export function engineFor(project: string | null, sessionId: string | null): string | null {
  if (sessionId) {
    const owner = sessionOwner(sessionId);
    if (owner) return owner;
  }
  const s = useSessionStore.getState();
  if (s.currentEngineId && project && project === s.currentProject && (!sessionId || sessionId === s.currentSessionId)) {
    return s.currentEngineId;
  }
  return selectedEngineId();
}

function currentEngine(): string | null {
  const { currentProject, currentSessionId } = useSessionStore.getState();
  return engineFor(currentProject, currentSessionId);
}

// ---------------------------------------------------------------------------
// Outgoing
// ---------------------------------------------------------------------------
// Inserts are chained so they commit in call order — "init" then "user_message"
// must reach the engine in that order.
let sendQueue: Promise<unknown> = Promise.resolve();

export function send(msg: ClientMessage, engineId: string | null = currentEngine()): Promise<boolean> {
  if (!engineId || !isEngineOnline(engineId)) return Promise.resolve(false);
  const { currentProject, currentSessionId } = useSessionStore.getState();
  const run = sendQueue.then(async () => {
    const { error } = await supabase.from("commands").insert({
      engine_id: engineId,
      client_id: clientId,
      payload: msg,
      project_path: currentProject,
      session_id: currentSessionId,
    });
    if (error) {
      useConnectionStore.getState().setStatus("error", `Couldn't reach the hub: ${error.message}`);
      return false;
    }
    return true;
  });
  sendQueue = run.catch(() => {});
  return run;
}

export function sendInit(intent: { project: string; sessionId?: string; forceNew?: boolean }): void {
  busySessionId = null;
  const full: InitIntent = { ...buildInit(intent.project, intent.sessionId || null), forceNew: intent.forceNew };
  // Remembered and replayed when the engine (re)appears, same contract as the old
  // WebSocket reconnect: a "new session" request is never silently dropped.
  useConnectionStore.getState().setLastInit(full);
  const target = engineFor(intent.project, intent.forceNew ? null : intent.sessionId || null);
  if (isEngineOnline(target)) {
    connectedEngine = target;
    void send(full, target);
  } else {
    void loadReadOnly(intent.forceNew ? null : intent.sessionId || null);
  }
  refreshConnectionStatus();
}

// ---------------------------------------------------------------------------
// Transcripts from the hub (works with every device offline)
// ---------------------------------------------------------------------------
export async function fetchHistory(sessionId: string): Promise<HistoryItem[]> {
  const items: HistoryItem[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("session_events")
      .select("payload")
      .eq("session_id", sessionId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    items.push(...data.map((r) => r.payload as HistoryItem));
    if (data.length < PAGE) return items;
  }
}

async function loadHistoryInto(sessionId: string): Promise<void> {
  try {
    const items = await fetchHistory(sessionId);
    const current = useSessionStore.getState().currentSessionId;
    if (current && current !== sessionId) return; // switched away while loading
    useChatStore.getState().loadHistory(items);
  } catch (e) {
    useConnectionStore.getState().setStatus("error", `Couldn't load history: ${(e as Error).message}`);
  }
}

// Only an explicitly chosen session is shown while its device is offline. Never
// guess "latest" here: adopting a guessed id would make the next init --resume it,
// bypassing the engine's own rules (e.g. never auto-resume in the bare home folder,
// where the latest session may be live in VS Code or a terminal).
async function loadReadOnly(sessionId: string | null): Promise<void> {
  if (sessionId) await loadHistoryInto(sessionId);
}

// ---------------------------------------------------------------------------
// Engine-level request/response (folder browser)
// ---------------------------------------------------------------------------
export type BrowseResult = { path: string; parent: string | null; dirs: { name: string; path: string }[] };
const pendingBrowse = new Map<string, { resolve: (r: BrowseResult) => void; reject: (e: Error) => void }>();

export function browseDirs(path?: string): Promise<BrowseResult> {
  const engineId = selectedEngineId();
  if (!engineId) return Promise.reject(new Error("No engine online"));
  const requestId = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pendingBrowse.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pendingBrowse.delete(requestId)) reject(new Error("The device didn't answer in time"));
    }, 15_000);
    void send({ type: "browse_dirs", request_id: requestId, path }, engineId);
  });
}

// ---------------------------------------------------------------------------
// Incoming
// ---------------------------------------------------------------------------
async function handleServerEvent(evt: ServerMessage, engineId: string): Promise<void> {
  const chat = useChatStore.getState();
  const session = useSessionStore.getState();
  const connection = useConnectionStore.getState();
  const auth = useAuthStore.getState();

  switch (evt.type) {
    case "session_init":
      connectedEngine = engineId;
      connection.setStatus("connected", `Connected · ${engineId}${evt.reattached ? " · reattached to live session" : ""}`);
      session.setSession(evt.project, evt.session_id, !!evt.reattached, engineId);
      session.setTurnState("idle");
      connection.setLastInit(null);
      useTabsStore.getState().upsertTab(evt.project, evt.session_id);
      updateUrlForCurrent(evt.project, evt.session_id);
      void refreshSessions();
      break;
    case "history_ready":
      await loadHistoryInto(evt.session_id);
      break;
    case "error":
      chat.hideWorkingIndicator();
      connection.setStatus("error", evt.message);
      break;
    case "message_delivered":
      chat.showWorkingIndicator("Delivered — waiting for Claude to start…");
      session.setTurnState("processing");
      break;
    case "settings_applied":
      chat.onTurnComplete();
      session.setTurnState("idle");
      break;
    case "assistant_text_delta":
      chat.appendAssistantDelta(evt.text);
      break;
    case "thinking_start":
      chat.appendThinkingDelta("");
      break;
    case "thinking_delta":
      chat.appendThinkingDelta(evt.text);
      break;
    case "content_block_stop":
      chat.finalizeThinking();
      chat.finalizeStreamingText();
      break;
    case "working":
      chat.showWorkingIndicator("Claude is working…");
      session.setTurnState("processing");
      break;
    case "stall_warning":
      chat.showStallWarning(evt.message);
      break;
    case "tool_use":
      chat.addToolUse(evt.id, evt.name, evt.input);
      break;
    case "tool_result":
      chat.addToolResult(evt.tool_use_id, evt.content, evt.images, evt.is_error);
      break;
    case "approval_request":
      chat.addApprovalRequest(evt.request_id, evt.tool_name, evt.input, evt.description);
      session.setTurnState("permission");
      break;
    case "turn_complete":
      chat.onTurnComplete();
      session.setTurnState("idle");
      break;
    case "process_exit":
      chat.onTurnComplete();
      connection.setStatus("error", `Agent process exited (code ${evt.code}) — restarting…`);
      session.setTurnState("idle");
      if (session.currentProject) {
        const { currentProject, currentSessionId } = session;
        setTimeout(() => sendInit({ project: currentProject, sessionId: currentSessionId || undefined }), 500);
      }
      break;
    case "auth_required":
      connection.setStatus("error", `Claude login needed on ${engineId} — use Manage on that device in the sidebar`);
      auth.setStatus(evt.authStatus);
      break;
    case "login_url":
      auth.setLoginUrl(evt.url);
      break;
    case "login_result":
      auth.setLoginResult(evt.success, evt.authStatus, evt.message);
      break;
    case "tab_status": {
      const display = evt.status === "idle" && evt.unread ? "unread" : evt.status;
      useTabStatusStore.getState().setStatus(tabKey(evt.project, evt.sessionId), display);
      scheduleRefreshSessions();
      break;
    }
    case "browse_result":
    case "browse_error": {
      const pending = pendingBrowse.get(evt.request_id);
      if (!pending) break;
      pendingBrowse.delete(evt.request_id);
      if (evt.type === "browse_result") pending.resolve({ path: evt.path, parent: evt.parent, dirs: evt.dirs });
      else pending.reject(new Error(evt.message));
      break;
    }
    case "mcp_error":
      useMcpStore.getState().setError(evt.message);
      break;
    case "session_busy":
      busySessionId = evt.session_id;
      connection.setLastInit(null); // don't keep retrying the same refused resume
      connection.setStatus(
        "offline",
        `Open in another app right now (updated ${evt.seconds_ago}s ago) — read-only here. Start a new session to chat.`
      );
      await loadHistoryInto(evt.session_id);
      break;
  }
}

// Strictly in order: history_ready awaits a DB read, and live events behind it
// must not be applied to the chat before the history they follow.
let eventQueue: Promise<void> = Promise.resolve();
// A slow history load must never freeze everything behind it.
const EVENT_TIMEOUT_MS = 20_000;

// Request/response replies don't depend on chat ordering; handle them at once so
// they can't get stuck behind a slow history load.
const UNORDERED = new Set(["browse_result", "browse_error", "mcp_error"]);

function enqueueEvent(envelope: HubEnvelope): void {
  if (UNORDERED.has(envelope.msg.type)) {
    void handleServerEvent(envelope.msg, envelope.engine_id).catch((e) => console.error("hub event:", e));
    return;
  }
  eventQueue = eventQueue
    .then(() =>
      Promise.race([
        handleServerEvent(envelope.msg, envelope.engine_id),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn(`hub event "${envelope.msg.type}" took over ${EVENT_TIMEOUT_MS / 1000}s; continuing`);
            resolve();
          }, EVENT_TIMEOUT_MS)
        ),
      ])
    )
    .catch((e) => console.error("hub event:", e));
}

// ---------------------------------------------------------------------------
// Availability: connected when the current session's engine is online
// ---------------------------------------------------------------------------
export function refreshConnectionStatus(): void {
  const connection = useConnectionStore.getState();
  if (!presenceCh || presenceCh.state !== "joined") return;
  const target = currentEngine();
  if (busySessionId && busySessionId === useSessionStore.getState().currentSessionId) return; // keep the read-only notice
  if (isEngineOnline(target)) {
    if (connection.status !== "connected") connection.setStatus("connected", `Connected · ${target}`);
  } else {
    const anyOnline = useEngineStore.getState().online.length > 0;
    connection.setStatus(
      "offline",
      anyOnline && target ? `${target} is offline — read-only` : "No engine online — read-only"
    );
  }
}

function syncEngineDerivedStores(): void {
  const engineId = currentEngine() ?? Object.keys(useEngineStore.getState().engines)[0];
  const row = engineId ? useEngineStore.getState().engines[engineId] : undefined;
  if (!row) return;
  if (row.claude_auth) useAuthStore.getState().setStatus(row.claude_auth);
}

function onAvailabilityChange(): void {
  const { currentProject, currentSessionId } = useSessionStore.getState();
  const target = engineFor(currentProject, currentSessionId);
  if (isEngineOnline(target)) {
    if (connectedEngine !== target) {
      connectedEngine = target;
      const lastInit = useConnectionStore.getState().lastInit;
      if (lastInit) void send(lastInit, target);
      else if (currentProject) void send(buildInit(currentProject, currentSessionId), target);
    }
  } else {
    connectedEngine = null;
  }
  refreshConnectionStatus();
  syncEngineDerivedStores();
  scheduleRefreshSessions();
}

function buildInit(project: string, sessionId: string | null): InitIntent {
  const settings = useSettingsStore.getState();
  return {
    type: "init",
    project,
    sessionId: sessionId || undefined,
    model: settings.model || undefined,
    effort: settings.effort || undefined,
    permissionMode: settings.permissionMode || undefined,
    mcpPreset: settings.mcpPreset,
  };
}

let enginesLoaded: Promise<void> | null = null;

export function startHub(): Promise<void> {
  if (started) return enginesLoaded!;
  started = true;
  useConnectionStore.getState().setStatus("connecting", "Connecting to hub…");

  enginesLoaded = Promise.resolve(
    supabase
      .from("engines")
      .select("id, hostname, home_dir, default_project, claude_auth, mcp, mcp_checked_at, last_seen_at, fingerprint, device_name, model, platform")
      .then(({ data }) => {
        useEngineStore.getState().setEngines((data as EngineRow[]) || []);
        syncEngineDerivedStores();
        ensureEngineChannels();
      })
  );

  supabase
    .channel("engine-rows")
    .on("postgres_changes", { event: "*", schema: "public", table: "engines" }, (payload) => {
      if (payload.new && "id" in payload.new) {
        useEngineStore.getState().upsertEngine(payload.new as EngineRow);
        syncEngineDerivedStores();
        ensureEngineChannels();
      }
    })
    .subscribe();

  presenceCh = supabase
    .channel("presence", { config: { private: true, presence: { key: `client:${clientId}` } } })
    .on("presence", { event: "sync" }, () => {
      const ids = new Set<string>();
      for (const presences of Object.values(presenceCh!.presenceState<{ kind: string; id: string }>())) {
        for (const p of presences) if (p.kind === "engine") ids.add(p.id);
      }
      useEngineStore.getState().setOnline([...ids]);
      onAvailabilityChange();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        onAvailabilityChange();
        await presenceCh!.track({ kind: "client", id: clientId });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        connectedEngine = null;
        useConnectionStore.getState().setStatus("reconnecting", "Hub connection lost — reconnecting…");
      }
    });

  // Sidebar freshness without subscribing to every sessions-row write.
  setInterval(() => void refreshSessions(), 60_000);
  // A device that went to sleep stops heartbeating without leaving presence.
  setInterval(() => {
    const before = useEngineStore.getState().online.join();
    useEngineStore.getState().recheck();
    if (useEngineStore.getState().online.join() !== before) onAvailabilityChange();
  }, 15_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshSessions();
  });

  return enginesLoaded;
}

// One private output channel per known engine.
function ensureEngineChannels(): void {
  for (const engineId of Object.keys(useEngineStore.getState().engines)) {
    if (engineChannels.has(engineId)) continue;
    const ch = supabase
      .channel(`engine:${engineId}`, { config: { private: true } })
      .on("broadcast", { event: "server" }, ({ payload }) => {
        const envelope = payload as HubEnvelope;
        // Only this engine can publish here; still ignore anything claiming otherwise.
        if (envelope.engine_id !== engineId) return;
        if (envelope.to === null || envelope.to === clientId) enqueueEvent(envelope);
      })
      .subscribe();
    engineChannels.set(engineId, ch);
  }
}

// Default project for a first visit: the selected device's home, else any known device's.
export async function resolveDefaultProject(): Promise<string | null> {
  await startHub();
  const { engines } = useEngineStore.getState();
  const preferred = selectedEngineId();
  return (preferred && engines[preferred]?.default_project) || Object.values(engines)[0]?.default_project || null;
}

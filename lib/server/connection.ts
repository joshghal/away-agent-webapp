import { existsSync, statSync } from "node:fs";
import { state } from "./singleton";
import { isAlive, spawnFor, killLive, withProjectLock, broadcastTabStatus, markRead } from "./liveSessions";
import { listDirectories, transcriptModifiedAt } from "./sessions";
import { createLoginSession } from "./login";
import { HOME, DEFAULT_PROJECT_DIR } from "./env";
import type { ClientMessage, ServerMessage } from "../shared/ws-protocol";

const { liveSessions } = state;

const FOREIGN_ACTIVITY_WINDOW_MS = 60_000;

// True when another app (VS Code, a terminal) wrote this session moments ago and
// we didn't. Resuming it would put two processes on one transcript and corrupt it.
function activeElsewhere(project: string, sessionId: string): number | null {
  const modified = transcriptModifiedAt(project, sessionId);
  if (modified === null || Date.now() - modified > FOREIGN_ACTIVITY_WINDOW_MS) return null;
  const ownedAt = state.recentlyOwned.get(sessionId);
  if (ownedAt && ownedAt >= modified - 5_000) return null;
  return Math.round((Date.now() - modified) / 1000);
}

type AttachOptions = {
  sessionId?: string;
  forceNew?: boolean;
  model?: string;
  effort?: string;
  permissionMode?: string;
  mcpPreset?: string;
};

export type SessionMessage = Exclude<
  ClientMessage,
  { type: "browse_dirs" | "mcp_refresh" | "mcp_add" | "mcp_remove" | "auth_refresh" | "delete_session" }
>;

export type Connection = {
  process: (msg: SessionMessage) => Promise<void>;
  close: () => void;
};

// One viewer of live sessions (a browser tab, reached through the hub). `send`
// delivers to that viewer only; `prepareHistory` must make the session's
// transcript readable from the hub before `history_ready` tells the viewer to load it.
export function createConnection(opts: {
  send: (obj: ServerMessage) => void;
  prepareHistory: (project: string, sessionId: string) => Promise<void>;
}): Connection {
  const { send, prepareHistory } = opts;
  let attachedProject: string | null = null;
  const login = createLoginSession(send);

  function detach(): void {
    if (attachedProject) {
      const entry = liveSessions.get(attachedProject);
      if (entry) entry.subscribers.delete(send);
      attachedProject = null;
    }
  }

  async function sendHistory(project: string, sessionId: string): Promise<void> {
    await prepareHistory(project, sessionId);
    send({ type: "history_ready", session_id: sessionId });
  }

  async function attach(project: string, opts: AttachOptions = {}): Promise<void> {
    const { sessionId, forceNew, model, effort, permissionMode, mcpPreset } = opts;
    if (!existsSync(project) || !statSync(project).isDirectory()) {
      send({ type: "error", message: `Not a directory: ${project}` });
      return;
    }
    detach();
    attachedProject = project;

    // The read-decide-mutate sequence below (check what's live, maybe kill it, maybe
    // spawn a replacement) must run as one atomic step relative to any other pending
    // attach/update_settings for this SAME project — otherwise two calls arriving
    // close together (e.g. a reconnect racing a settings change) each read the
    // pre-mutation state and both spawn a replacement, leaving the first one orphaned.
    let entry: ReturnType<typeof liveSessions.get>;
    await withProjectLock(project, async () => {
      const currentEntry = liveSessions.get(project);
      const wantsDifferentSession = forceNew || (sessionId && currentEntry && currentEntry.sessionId !== sessionId);
      const currentlyAlive = isAlive(project);

      if (currentlyAlive && !wantsDifferentSession) {
        entry = currentEntry!;
        if (entry.sessionId) await sendHistory(project, entry.sessionId);
        send({ type: "session_init", session_id: entry.sessionId, cwd: project, project, reattached: true });
      } else {
        if (sessionId) {
          const secondsAgo = activeElsewhere(project, sessionId);
          if (secondsAgo !== null) {
            send({ type: "session_busy", session_id: sessionId, seconds_ago: secondsAgo });
            attachedProject = null;
            return;
          }
        }
        if (currentlyAlive) await killLive(project); // switching to a different session in the same project — wait for it to actually die first
        let targetSessionId = sessionId || null;
        // Never auto-resume "latest" for the bare home directory — sessions there
        // are shared with every tool that runs `claude` outside a specific project
        // (VS Code, an ad-hoc terminal), so "most recent" can land you inside
        // someone else's still-live conversation. An explicit sessionId still
        // works normally.
        const isBareHome = project === HOME;
        if (!forceNew && !targetSessionId && !isBareHome) {
          const dirs = listDirectories();
          const match = dirs.find((d) => d.projectPath === project);
          targetSessionId = match?.sessions[0]?.sessionId || null;
        }
        if (targetSessionId) await sendHistory(project, targetSessionId);
        entry = spawnFor(project, { resumeSessionId: targetSessionId, model, effort, permissionMode, mcpPreset });
      }
    });
    if (!entry) return; // refused (session active in another app)
    entry.subscribers.add(send);
    for (const approvalEvt of entry.pendingApprovals.values()) send(approvalEvt);
    markRead(project);
  }

  // Messages for one viewer must run strictly one at a time: "init" immediately
  // followed by "user_message" (what the client does on every fresh session) would
  // otherwise let the second run before the first's lock-deferred spawnFor() had
  // registered the live entry, silently dropping the message.
  let messageQueue: Promise<void> = Promise.resolve();

  function processMessage(msg: SessionMessage): Promise<void> {
    const run = messageQueue.then(() => handle(msg));
    messageQueue = run.catch((e) => console.error("message handler error:", e));
    return run;
  }

  async function handle(msg: SessionMessage): Promise<void> {
    if (msg.type === "init") {
      await attach(msg.project || DEFAULT_PROJECT_DIR, {
        sessionId: msg.sessionId,
        forceNew: msg.forceNew,
        model: msg.model,
        effort: msg.effort,
        permissionMode: msg.permissionMode,
        mcpPreset: msg.mcpPreset,
      });
    } else if (msg.type === "user_message") {
      const entry = attachedProject && liveSessions.get(attachedProject);
      if (entry && !entry.child.stdin.destroyed) {
        entry.child.stdin.write(
          JSON.stringify({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: msg.text }] },
          }) + "\n"
        );
        entry.turnStartedAt = Date.now();
        entry.lastActivityAt = Date.now();
        entry.stallLevelNotified = 0;
        send({ type: "message_delivered" });
        broadcastTabStatus(attachedProject!);
      } else {
        send({ type: "error", message: "No active session to send to — reconnect or start a new session." });
      }
    } else if (msg.type === "approval_response") {
      const entry = attachedProject && liveSessions.get(attachedProject);
      if (entry) entry.pendingApprovals.delete(msg.request_id);
      if (entry && !entry.child.stdin.destroyed) {
        entry.child.stdin.write(
          JSON.stringify({
            type: "control_response",
            response: {
              request_id: msg.request_id,
              subtype: "success",
              response: msg.allow
                ? { behavior: "allow", updatedInput: msg.input }
                : { behavior: "deny", message: msg.reason || "Denied by user" },
            },
          }) + "\n"
        );
        entry.turnStartedAt = Date.now();
        entry.lastActivityAt = Date.now();
        entry.stallLevelNotified = 0;
      }
      if (attachedProject) broadcastTabStatus(attachedProject);
    } else if (msg.type === "update_settings") {
      // model/effort/permission-mode/mcp-preset are CLI flags fixed at spawn time —
      // the only honest way to apply a change is restarting against the same session id.
      if (!attachedProject) return;
      const project = attachedProject;
      let entry: NonNullable<ReturnType<typeof liveSessions.get>>;
      await withProjectLock(project, async () => {
        const currentEntry = liveSessions.get(project);
        const resumeSessionId = currentEntry ? currentEntry.sessionId : null;
        if (isAlive(project)) await killLive(project);
        entry = spawnFor(project, {
          resumeSessionId,
          model: msg.model,
          effort: msg.effort,
          permissionMode: msg.permissionMode,
          mcpPreset: msg.mcpPreset,
        });
      });
      entry!.subscribers.add(send);
      send({ type: "settings_applied" });
      broadcastTabStatus(project);
    } else if (msg.type === "kill_session") {
      // Not scoped to attachedProject: the tab being closed may not be the one
      // this viewer is currently looking at.
      if (msg.project) {
        await withProjectLock(msg.project, async () => {
          if (isAlive(msg.project)) await killLive(msg.project);
        });
        broadcastTabStatus(msg.project);
      }
    } else if (msg.type === "login_start") {
      login.start();
    } else if (msg.type === "login_code") {
      login.submitCode(msg.code);
    }
  }

  function close(): void {
    // Deliberately NOT killing the underlying claude process — it keeps running
    // until explicitly switched away from or its tab is closed.
    detach();
    login.cleanup();
  }

  return { process: processMessage, close };
}

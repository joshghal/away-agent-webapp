import { spawn } from "node:child_process";
import { state, type LiveSessionEntry } from "./singleton";
import { extractToolResultParts } from "./sessions";
import { getAuthStatus } from "./authStatus";
import { VALID_PERMISSION_MODES, MCP_PRESETS } from "../shared/constants";
import type { ServerMessage, TurnStatus } from "../shared/ws-protocol";

const { liveSessions, projectLocks } = state;

export function isAlive(project: string): boolean {
  const entry = liveSessions.get(project);
  return !!(entry && entry.child && !entry.child.killed && entry.child.exitCode === null);
}

export function broadcast(project: string, obj: ServerMessage): void {
  const entry = liveSessions.get(project);
  if (!entry) return;
  entry.lastActivityAt = Date.now();
  for (const send of entry.subscribers) send(obj);
}

export function getTurnStatus(entry: LiveSessionEntry | undefined): TurnStatus {
  if (!entry) return "idle";
  if (entry.pendingApprovals.size > 0) return "permission";
  if (entry.turnStartedAt) return "processing";
  return "idle";
}

// Unlike broadcast() above, this goes to every connected socket regardless of
// which project (if any) it's attached to — the whole point of a tab strip
// showing status for tabs you AREN'T currently looking at.
export function broadcastTabStatus(project: string): void {
  const entry = liveSessions.get(project);
  const msg: ServerMessage = {
    type: "tab_status",
    project,
    sessionId: entry?.sessionId ?? null,
    status: getTurnStatus(entry),
    unread: entry?.unread ?? false,
  };
  for (const send of state.allConnections) send(msg);
}

// Called whenever a connection actually attaches to view this project's live
// session — clears "unread" (tracked server-side precisely so it survives a
// page refresh, unlike a purely client-derived "was this the active tab" flag)
// and lets every connection know.
export function markRead(project: string): void {
  const entry = liveSessions.get(project);
  if (!entry || !entry.unread) return;
  entry.unread = false;
  broadcastTabStatus(project);
}

// Returns a promise that resolves once the process (and its group) has actually
// exited — NOT just once the signal was sent. Confirmed this distinction matters:
// under rapid successive respawns (e.g. changing model/effort/permission-mode in
// quick succession), the old fire-and-forget SIGTERM regularly left the previous
// process alive — sometimes for many minutes — while a new one was already
// spawned for the same session, so both kept running and racing to write to the
// same session transcript and to have their output broadcast to the client. SIGKILL
// escalation after a short grace period guarantees this actually converges.
export function killProcessGroup(child: LiveSessionEntry["child"] | undefined): Promise<void> {
  if (!child || child.killed || !child.pid) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.once("close", done);
    try {
      process.kill(-child.pid!, "SIGTERM"); // negative pid = whole process group
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      if (settled) return;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      setTimeout(done, 500); // give SIGKILL a moment to land, then stop waiting regardless
    }, 1500);
  });
}

export async function killLive(project: string): Promise<void> {
  const entry = liveSessions.get(project);
  // Delete synchronously, before awaiting the actual kill — so a second call
  // racing in right behind this one (e.g. another rapid settings change) sees
  // nothing here and won't try to kill the same entry twice.
  liveSessions.delete(project);
  if (entry) await killProcessGroup(entry.child);
}

// Serializes kill+respawn sequences per project. Necessary because the WS message
// handler is async (needed so it can await killLive) but Node does NOT wait for an
// async event listener to finish before dispatching the next queued event — three
// rapid "init"/"update_settings" messages for the same project were each starting
// their own concurrent kill-then-spawn cycle before an earlier one finished,
// producing real orphaned duplicate processes. Routing every kill+spawn sequence
// through this queue makes them run one at a time, in order, per project.
export function withProjectLock<T>(project: string, fn: () => Promise<T> | T): Promise<T> {
  const prevSettled = projectLocks.get(project) || Promise.resolve();
  const result = prevSettled.then(fn) as Promise<T>;
  projectLocks.set(
    project,
    result.catch(() => {})
  );
  return result;
}

export type SpawnOptions = {
  resumeSessionId?: string | null;
  model?: string;
  effort?: string;
  permissionMode?: string;
  mcpPreset?: string;
};

// "Bypass permissions" lets Claude run any command with no approval. Requests come
// from the web, so a stolen browser session could ask for it; only this device's
// own config (ALLOW_BYPASS_PERMISSIONS=1 in .env.engine) can allow it.
export function bypassAllowed(): boolean {
  return process.env.ALLOW_BYPASS_PERMISSIONS === "1";
}

export function spawnFor(project: string, opts: SpawnOptions = {}): LiveSessionEntry {
  const { resumeSessionId, model, effort, mcpPreset } = opts;
  let { permissionMode } = opts;
  const bypassRefused = permissionMode === "bypassPermissions" && !bypassAllowed();
  if (bypassRefused) permissionMode = "default";
  console.log(
    "Spawning claude process for",
    project,
    resumeSessionId ? `(resuming ${resumeSessionId})` : "(new session)",
    { model, effort, permissionMode, mcpPreset }
  );

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--include-partial-messages",
    "--verbose",
  ];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (permissionMode && VALID_PERMISSION_MODES.has(permissionMode)) args.push("--permission-mode", permissionMode);
  if (permissionMode === "bypassPermissions") args.push("--allow-dangerously-skip-permissions"); // the CLI ignores bypass mode without it
  const presetConfig = MCP_PRESETS[mcpPreset || "none"];
  if (presetConfig) args.push("--strict-mcp-config", "--mcp-config", presetConfig);

  let stderrBuf = "";

  // detached: true makes this process its own group leader, so killing the group
  // (see killLive) also takes down whatever MCP servers it spawned — otherwise
  // those become orphans that outlive it.
  const child = spawn("claude", args, { cwd: project, stdio: ["pipe", "pipe", "pipe"], detached: true }) as any;
  const entry: LiveSessionEntry = {
    child,
    sessionId: resumeSessionId || null,
    subscribers: new Set(),
    pendingApprovals: new Map(),
    // Stall detection: turnStartedAt marks a turn genuinely in flight (set on
    // message_delivered, cleared on turn_complete); lastActivityAt is bumped on
    // every broadcast. A background check (see stallDetection.ts) compares them.
    turnStartedAt: null,
    lastActivityAt: Date.now(),
    stallLevelNotified: 0,
    unread: false,
  };
  liveSessions.set(project, entry);
  if (bypassRefused) {
    // After the caller has subscribed (it does so once its project lock settles).
    setTimeout(
      () =>
        broadcast(project, {
          type: "error",
          message:
            "Bypass permissions is turned off on this device, so this session asks before running tools. To allow it, add ALLOW_BYPASS_PERMISSIONS=1 to .env.engine on the device and restart its engine.",
        }),
      0
    );
  }

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) handleChildEvent(project, line);
    }
  });
  child.stderr.on("data", (d: Buffer) => {
    stderrBuf += d.toString();
    console.error(`[${project}] claude stderr:`, d.toString());
  });
  // Without this, a missing `claude` binary (ENOENT) is an unhandled 'error'
  // event that crashes the whole engine. 'close' still follows for cleanup.
  let spawnFailed = false;
  child.on("error", (err: NodeJS.ErrnoException) => {
    spawnFailed = true;
    const message =
      err.code === "ENOENT"
        ? "Claude Code isn't installed on this device (no `claude` on its PATH). Install it, run `claude auth login`, then restart the engine."
        : `Couldn't start claude: ${err.message}`;
    console.error(`[${project}] ${message}`);
    broadcast(project, { type: "error", message });
  });
  child.on("close", (code: number | null) => {
    if (entry.sessionId) state.recentlyOwned.set(entry.sessionId, Date.now());
    liveSessions.delete(project);
    broadcastTabStatus(project);
    // A --resume against a session ID that no longer exists fails immediately —
    // fall back to a fresh session instead of handing the client a dead end
    // (or worse, an infinite retry loop on the same broken ID).
    // Already reported via 'error'. Sending process_exit would make the browser
    // retry immediately, looping forever while `claude` is missing.
    if (spawnFailed) return;
    const resumeFailed = resumeSessionId && /No conversation found/i.test(stderrBuf);
    const authFailed = /unauthorized|not authenticated|invalid_grant|please.{0,15}log.?in|401/i.test(stderrBuf);
    if (authFailed) {
      console.warn(`[${project}] process exited due to an apparent auth failure`);
      broadcast(project, { type: "auth_required", authStatus: getAuthStatus() });
    } else if (resumeFailed) {
      console.warn(`[${project}] --resume ${resumeSessionId} failed, retrying as a fresh session`);
      const fresh = spawnFor(project, { model, effort });
      fresh.subscribers = entry.subscribers;
      broadcast(project, { type: "error", message: "Previous session could not be resumed — started a new one." });
    } else {
      broadcast(project, { type: "process_exit", code });
    }
  });

  return entry;
}

function handleChildEvent(project: string, line: string): void {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return;
  }
  const entry = liveSessions.get(project);

  switch (obj.type) {
    case "system":
      if (obj.subtype === "init" && entry) {
        entry.sessionId = obj.session_id;
        broadcast(project, { type: "session_init", session_id: obj.session_id, cwd: obj.cwd, project });
        broadcastTabStatus(project);
      } else if (obj.subtype === "status") {
        // Fires the moment a turn actually starts being processed — the direct
        // answer to "did my message even reach Claude": immediate confirmation it
        // did, well before any text or thinking has been generated yet.
        broadcast(project, { type: "working", status: obj.status });
      }
      break;

    // With --include-partial-messages, text and thinking arrive incrementally here
    // as the model generates them. The final "assistant" event below still carries
    // tool_use (not worth streaming char-by-char) but text/thinking are
    // deliberately NOT re-sent from there, since these deltas already delivered
    // the full content.
    case "stream_event": {
      const streamEvt = obj.event || {};
      if (streamEvt.type === "content_block_delta") {
        if (streamEvt.delta?.type === "thinking_delta") {
          broadcast(project, { type: "thinking_delta", text: streamEvt.delta.thinking });
        } else if (streamEvt.delta?.type === "text_delta") {
          broadcast(project, { type: "assistant_text_delta", text: streamEvt.delta.text });
        }
      } else if (streamEvt.type === "content_block_start" && streamEvt.content_block?.type === "thinking") {
        broadcast(project, { type: "thinking_start" });
      } else if (streamEvt.type === "content_block_stop") {
        broadcast(project, { type: "content_block_stop" });
      }
      break;
    }

    case "assistant": {
      const content = obj.message?.content || [];
      for (const block of content) {
        if (block.type === "tool_use") {
          broadcast(project, { type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
      }
      break;
    }

    case "user": {
      const content = obj.message?.content || [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const { text, images } = extractToolResultParts(block.content);
          broadcast(project, {
            type: "tool_result",
            tool_use_id: block.tool_use_id,
            content: text,
            images,
            is_error: !!block.is_error,
          });
        }
      }
      break;
    }

    case "control_request": {
      const req = obj.request || {};
      const approvalEvt = {
        type: "approval_request" as const,
        request_id: obj.request_id,
        tool_name: req.tool_name,
        input: req.input,
        description: req.description,
      };
      if (entry) {
        entry.pendingApprovals.set(obj.request_id, approvalEvt);
        // Waiting on you to tap Allow/Deny is an expected pause, not a hang —
        // don't let stall detection fire while it's just waiting on a human.
        entry.turnStartedAt = null;
      }
      broadcast(project, approvalEvt);
      broadcastTabStatus(project);
      break;
    }

    case "result":
      if (entry) {
        entry.turnStartedAt = null;
        entry.stallLevelNotified = 0;
        // Nobody subscribed means nobody saw this land live in their chat pane —
        // that's the actual definition of "unread" here, not "not the active
        // tab" (which a subscriber already viewing this exact session always is).
        entry.unread = entry.subscribers.size === 0;
      }
      broadcast(project, {
        type: "turn_complete",
        result: obj.result,
        is_error: obj.is_error,
        cost_usd: obj.total_cost_usd,
      });
      broadcastTabStatus(project);
      break;

    default:
      break;
  }
}

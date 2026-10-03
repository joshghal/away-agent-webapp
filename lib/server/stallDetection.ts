import { state } from "./singleton";
import { broadcast } from "./liveSessions";

// "Claude is working…" alone can't distinguish genuine progress from a real hang
// (confirmed this happens — mcp-atlassian/uv lock contention can wedge a turn for
// minutes with zero output). Escalating thresholds since the turn started; each
// level fires once, not repeatedly, so it doesn't spam a persistent slow-but-fine turn.
const STALL_LEVELS = [
  { afterMs: 20_000, message: "Still waiting — this is taking longer than usual." },
  { afterMs: 60_000, message: "Over a minute with no response — this may be stuck (a past cause: MCP server startup contention)." },
  { afterMs: 180_000, message: "Over 3 minutes, still nothing — this looks genuinely stuck. Consider starting a new session." },
];

let started = false;

export function startStallDetection(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    const now = Date.now();
    for (const [project, entry] of state.liveSessions) {
      if (!entry.turnStartedAt) continue;
      // Silence since the last real event, not raw time since the turn started — a
      // turn that's been busy streaming output for 2 minutes isn't stalled; one
      // that's produced nothing since lastActivityAt is the actual signal.
      const silence = now - entry.lastActivityAt;
      const nextLevel = STALL_LEVELS[entry.stallLevelNotified];
      if (nextLevel && silence >= nextLevel.afterMs) {
        entry.stallLevelNotified++;
        console.warn(`[${project}] stall: ${Math.round(silence / 1000)}s with no output from claude (session ${entry.sessionId ?? "new"})`);
        broadcast(project, { type: "stall_warning", elapsedMs: now - entry.turnStartedAt, message: nextLevel.message });
      }
    }
  }, 10_000);
}

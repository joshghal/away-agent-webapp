import { useEngineStore } from "@/store/engineStore";
import { useSessionStore } from "@/store/sessionStore";
import { engineFor } from "@/lib/client/hub";
import type { EngineRow } from "@/lib/shared/ws-protocol";

// The device the open chat runs on, or where a fresh chat would start.
// Re-renders when the session or the device list changes.
export function useTargetEngine(): EngineRow | undefined {
  const { currentProject, currentSessionId, currentEngineId } = useSessionStore();
  const engines = useEngineStore((s) => s.engines);
  useEngineStore((s) => s.online.join() + (s.preferredId ?? ""));
  const id = currentEngineId ?? engineFor(currentProject, currentSessionId);
  return id ? engines[id] : undefined;
}

export function cliMissing(engine: EngineRow | undefined): boolean {
  return engine?.claude_auth?.state === "cli_missing";
}

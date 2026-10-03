import { useSettingsStore } from "@/store/settingsStore";
import { useConnectionStore } from "@/store/connectionStore";
import { useSessionStore } from "@/store/sessionStore";
import { send } from "@/lib/client/hub";

// model/effort/permission-mode/MCP-preset are all CLI flags fixed at process spawn
// time — there's no live "switch model" signal for an already-running headless
// process. Changing any of these while attached restarts the underlying process
// against the same session id (server-side update_settings), so the conversation
// continues but the very next message actually uses the new setting.
export function applySettingsLive(): void {
  const { currentProject } = useSessionStore.getState();
  if (useConnectionStore.getState().status !== "connected" || !currentProject) return;
  const { model, effort, permissionMode, mcpPreset } = useSettingsStore.getState();
  send({
    type: "update_settings",
    model: model || undefined,
    effort: effort || undefined,
    permissionMode: permissionMode || undefined,
    mcpPreset,
  });
}

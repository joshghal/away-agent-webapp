import { create } from "zustand";
import { persist } from "zustand/middleware";

// Deliberately transport-agnostic — this store does not know about WebSockets. A
// separate useApplySettingsLive() hook reacts to changes here and sends
// update_settings, keeping this testable without a live socket.
type SettingsState = {
  model: string;
  effort: string;
  permissionMode: string;
  mcpPreset: string;
  setModel: (v: string) => void;
  setEffort: (v: string) => void;
  setPermissionMode: (v: string) => void;
  setMcpPreset: (v: string) => void;
};

// Older builds offered specific versioned model ids instead of just the alias
// shorthands; without this, anyone who had picked one of those sees the dropdown
// unexpectedly replaced by the "Custom…" text field showing a raw id.
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-5": "sonnet",
  "claude-opus-5": "opus",
  "claude-fable-5-1": "fable",
  "claude-haiku-4-5-20251001": "haiku",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      model: "sonnet",
      effort: "high",
      permissionMode: "auto",
      mcpPreset: "none",
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      setPermissionMode: (permissionMode) => set({ permissionMode }),
      setMcpPreset: (mcpPreset) => set({ mcpPreset }),
    }),
    {
      name: "agent-webapp:settings",
      version: 1,
      migrate: (persisted) => {
        const state = persisted as SettingsState;
        const mapped = LEGACY_MODEL_ALIASES[state.model];
        return mapped ? { ...state, model: mapped } : state;
      },
    }
  )
);

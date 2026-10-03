import { create } from "zustand";
import { send } from "@/lib/client/hub";

// The server list itself lives on each device's engines row (engineStore); this
// only tracks an in-flight change and its error. `claude mcp list` health-checks
// every server, so a change takes ~15s to show up.
type McpState = {
  loading: boolean;
  error: string | null;
  refresh: (engineId: string) => Promise<void>;
  add: (engineId: string, name: string, url: string) => Promise<void>;
  remove: (engineId: string, name: string) => Promise<void>;
  settle: () => void;
  setError: (message: string) => void;
};

export const useMcpStore = create<McpState>((set) => {
  async function run(engineId: string, msg: Parameters<typeof send>[0]) {
    set({ loading: true, error: null });
    if (!(await send(msg, engineId))) set({ loading: false, error: "That device is offline." });
  }
  return {
    loading: false,
    error: null,
    refresh: (engineId) => run(engineId, { type: "mcp_refresh" }),
    add: (engineId, name, url) => run(engineId, { type: "mcp_add", name, url }),
    remove: (engineId, name) => run(engineId, { type: "mcp_remove", name }),
    settle: () => set({ loading: false }),
    setError: (error) => set({ error, loading: false }),
  };
});

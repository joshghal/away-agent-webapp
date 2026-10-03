import { create } from "zustand";
import type { McpListResponse, McpServerEntry } from "@/lib/shared/ws-protocol";
import { send } from "@/lib/client/hub";

type McpState = {
  servers: McpServerEntry[];
  warnings: string[];
  checkedAt: string | null;
  // A refresh/add/remove was sent and the device hasn't written a new result yet
  // (`claude mcp list` health-checks every server and takes ~15s).
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
  add: (name: string, url: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  setFromEngine: (mcp: McpListResponse | null, checkedAt: string | null) => void;
  setError: (message: string) => void;
};

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  warnings: [],
  checkedAt: null,
  loading: false,
  error: null,
  refresh: async (force = false) => {
    if (!force) return; // non-forced reads come straight from the engine row
    set({ loading: true, error: null });
    if (!(await send({ type: "mcp_refresh" }))) set({ loading: false });
  },
  add: async (name, url) => {
    set({ loading: true, error: null });
    if (!(await send({ type: "mcp_add", name, url }))) set({ loading: false });
  },
  remove: async (name) => {
    set({ loading: true, error: null });
    if (!(await send({ type: "mcp_remove", name }))) set({ loading: false });
  },
  setFromEngine: (mcp, checkedAt) => {
    if (!mcp) return;
    const fresh = checkedAt !== get().checkedAt;
    set({ servers: mcp.servers, warnings: mcp.warnings, checkedAt, ...(fresh ? { loading: false } : {}) });
  },
  setError: (error) => set({ error, loading: false }),
}));

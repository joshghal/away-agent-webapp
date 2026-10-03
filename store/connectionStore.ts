import { create } from "zustand";
import type { ClientMessage } from "@/lib/shared/ws-protocol";

// The most recent switch intent (including forceNew) — replayed on every
// (re)connect instead of just reading currentProject/currentSessionId directly.
// Confirmed bug this fixes: switchProject(forceNew:true) previously only sent to
// the server "if connected right now" — if the socket was mid-reconnect at that
// exact moment, the request was silently dropped, but the session id had already
// been reset locally. The next reconnect then sent a plain reattach with no
// forceNew, defaulting back to resuming the most recent session — "New session"
// would silently appear to do nothing.
export type InitIntent = Extract<ClientMessage, { type: "init" }>;

type ConnectionState = {
  // offline: hub reachable but the session's device isn't — history is read-only.
  status: "connecting" | "connected" | "reconnecting" | "offline" | "error";
  statusMessage: string;
  lastInit: InitIntent | null;
  setStatus: (status: ConnectionState["status"], message: string) => void;
  setLastInit: (intent: InitIntent | null) => void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "connecting",
  statusMessage: "Connecting…",
  lastInit: null,
  setStatus: (status, statusMessage) => set({ status, statusMessage }),
  setLastInit: (lastInit) => set({ lastInit }),
}));

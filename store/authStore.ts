import { create } from "zustand";
import type { AuthStatus } from "@/lib/shared/ws-protocol";
import { send } from "@/lib/client/hub";

type AuthState = {
  status: AuthStatus | null;
  // Which device's `claude` CLI login this is — each device has its own.
  engineId: string | null;
  deviceName: string | null;
  setDevice: (engineId: string, deviceName: string) => void;
  loginUrl: string | null;
  loginMessage: string | null;
  verifying: boolean;
  refresh: () => Promise<void>;
  setStatus: (status: AuthStatus) => void;
  setLoginUrl: (url: string) => void;
  setLoginResult: (success: boolean, status: AuthStatus, message?: string | null) => void;
  setVerifying: (v: boolean) => void;
  clearLoginFlow: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: null,
  engineId: null,
  deviceName: null,
  setDevice: (engineId, deviceName) =>
    set({ engineId, deviceName, loginUrl: null, loginMessage: null, verifying: false }),
  loginUrl: null,
  loginMessage: null,
  verifying: false,
  // The device re-checks and writes the result to its engines row, which flows
  // back into this store via the hub's engine-row subscription.
  refresh: async () => {
    await send({ type: "auth_refresh" }, useAuthStore.getState().engineId);
  },
  setStatus: (status) => set({ status }),
  setLoginUrl: (loginUrl) => set({ loginUrl, loginMessage: null }),
  setLoginResult: (success, status, message) =>
    set({
      status,
      loginUrl: success ? null : null,
      loginMessage: success ? null : `Login failed: ${message || "unknown error"} — try again.`,
      verifying: false,
    }),
  setVerifying: (verifying) => set({ verifying }),
  clearLoginFlow: () => set({ loginUrl: null, loginMessage: null, verifying: false }),
}));

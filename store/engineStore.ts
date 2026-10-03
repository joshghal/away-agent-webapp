import { create } from "zustand";
import type { EngineRow } from "@/lib/shared/ws-protocol";

const PREFERRED_KEY = "away-agent:preferredEngine";

type EngineState = {
  engines: Record<string, EngineRow>;
  loaded: boolean;
  online: string[];
  preferredId: string | null;
  setEngines: (rows: EngineRow[]) => void;
  upsertEngine: (row: EngineRow) => void;
  setOnline: (ids: string[]) => void;
  setPreferred: (id: string) => void;
};

export const useEngineStore = create<EngineState>((set) => ({
  engines: {},
  loaded: false,
  online: [],
  preferredId: typeof window === "undefined" ? null : localStorage.getItem(PREFERRED_KEY),
  setEngines: (rows) => set({ engines: Object.fromEntries(rows.map((r) => [r.id, r])), loaded: true }),
  upsertEngine: (row) => set((s) => ({ engines: { ...s.engines, [row.id]: row } })),
  setOnline: (online) => set({ online }),
  setPreferred: (preferredId) => {
    localStorage.setItem(PREFERRED_KEY, preferredId);
    set({ preferredId });
  },
}));

export function isEngineOnline(id: string | null | undefined): boolean {
  return !!id && useEngineStore.getState().online.includes(id);
}

// Where brand-new sessions start: your last-used device if it's online,
// otherwise any online device, otherwise none (read-only).
export function selectedEngineId(): string | null {
  const { online, preferredId } = useEngineStore.getState();
  if (preferredId && online.includes(preferredId)) return preferredId;
  return online[0] ?? null;
}

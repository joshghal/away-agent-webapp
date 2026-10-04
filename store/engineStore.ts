import { create } from "zustand";
import type { EngineRow } from "@/lib/shared/ws-protocol";

const PREFERRED_KEY = "away-agent:preferredEngine";
// Engines heartbeat every 30s. A sleeping laptop never formally disconnects, so
// Realtime presence can keep listing it for minutes — also require a recent heartbeat.
const HEARTBEAT_FRESH_MS = 75_000;

function fresh(row: EngineRow | undefined): boolean {
  return !!row && Date.now() - Date.parse(row.last_seen_at) < HEARTBEAT_FRESH_MS;
}

function computeOnline(present: string[], engines: Record<string, EngineRow>): string[] {
  return present.filter((id) => fresh(engines[id]));
}

type EngineState = {
  engines: Record<string, EngineRow>;
  loaded: boolean;
  // Engines in Realtime presence (raw) and the ones that are actually online.
  present: string[];
  online: string[];
  preferredId: string | null;
  setEngines: (rows: EngineRow[]) => void;
  upsertEngine: (row: EngineRow) => void;
  setOnline: (ids: string[]) => void;
  recheck: () => void;
  setPreferred: (id: string) => void;
};

export const useEngineStore = create<EngineState>((set) => ({
  engines: {},
  loaded: false,
  present: [],
  online: [],
  preferredId: typeof window === "undefined" ? null : localStorage.getItem(PREFERRED_KEY),
  setEngines: (rows) =>
    set((s) => {
      const engines = Object.fromEntries(rows.map((r) => [r.id, r]));
      return { engines, loaded: true, online: computeOnline(s.present, engines) };
    }),
  upsertEngine: (row) =>
    set((s) => {
      const engines = { ...s.engines, [row.id]: row };
      return { engines, online: computeOnline(s.present, engines) };
    }),
  setOnline: (present) => set((s) => ({ present, online: computeOnline(present, s.engines) })),
  recheck: () =>
    set((s) => {
      const online = computeOnline(s.present, s.engines);
      return online.join() === s.online.join() ? s : { online };
    }),
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

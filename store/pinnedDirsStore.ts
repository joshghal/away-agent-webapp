import { create } from "zustand";
import { persist } from "zustand/middleware";

// Starts empty — users pin directories via the New Session modal's folder
// browser (hover any directory → click the pin icon). Persisted to localStorage
// so pins survive page refreshes, same as tabs and settings.
const INITIAL_PINS: string[] = [];

type PinnedDirsState = {
  pins: string[];
  isPinned: (path: string) => boolean;
  toggle: (path: string) => void;
};

export const usePinnedDirsStore = create<PinnedDirsState>()(
  persist(
    (set, get) => ({
      pins: INITIAL_PINS,
      isPinned: (path) => get().pins.includes(path),
      toggle: (path) =>
        set((s) => ({
          pins: s.pins.includes(path) ? s.pins.filter((p) => p !== path) : [...s.pins, path],
        })),
    }),
    { name: "agent-webapp:pinnedDirs" }
  )
);

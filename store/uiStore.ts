import { create } from "zustand";

type SheetName = "config" | "device" | "newSession" | null;

type View = "chat" | "coordinator";

type UiState = {
  view: View;
  setView: (v: View) => void;
  drawerOpen: boolean;
  activeSheet: SheetName;
  setDrawerOpen: (v: boolean) => void;
  openSheet: (name: Exclude<SheetName, null>) => void;
  closeSheet: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  view: "chat",
  setView: (view) => set({ view, drawerOpen: false }),
  drawerOpen: false,
  activeSheet: null,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  openSheet: (activeSheet) => set({ activeSheet }),
  closeSheet: () => set({ activeSheet: null }),
}));

import { create } from "zustand";

type SheetName = "config" | "device" | "newSession" | null;

type UiState = {
  drawerOpen: boolean;
  activeSheet: SheetName;
  setDrawerOpen: (v: boolean) => void;
  openSheet: (name: Exclude<SheetName, null>) => void;
  closeSheet: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  drawerOpen: false,
  activeSheet: null,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  openSheet: (activeSheet) => set({ activeSheet }),
  closeSheet: () => set({ activeSheet: null }),
}));

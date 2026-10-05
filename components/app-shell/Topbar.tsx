"use client";
import { MenuIcon, SlidersIcon } from "@/components/icons/icons";
import { TurnStateBadge } from "./TurnStateBadge";
import { IconButton } from "@/components/ui";
import { useConnectionStore } from "@/store/connectionStore";
import { useUiStore } from "@/store/uiStore";

export function Topbar() {
  const { status, statusMessage } = useConnectionStore();
  const { setDrawerOpen, openSheet } = useUiStore();

  return (
    <div className="flex items-center gap-2 px-4 py-3 flex-none">
      <IconButton className="md:hidden" onClick={() => setDrawerOpen(true)} aria-label="Menu">
        <MenuIcon className="w-[17px] h-[17px]" />
      </IconButton>
      <div
        className={`flex-1 text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap ${
          status === "connected" ? "text-success" : status === "error" ? "text-danger" : status === "offline" ? "text-warn" : "text-text-3"
        }`}
      >
        {(status === "connected" || status === "error" || status === "offline") && <span className="mr-1.5">●</span>}
        {statusMessage}
      </div>
      <TurnStateBadge />
      <button
        onClick={() => openSheet("config")}
        className="flex items-center gap-1.5 flex-none bg-panel-strong border border-panel-border-soft rounded-full py-1.5 px-3.5 pr-3 text-xs font-medium text-text-2 hover:text-text-1 hover:border-white/16 transition-colors"
      >
        <SlidersIcon className="w-3.5 h-3.5" />
        Configure
      </button>
    </div>
  );
}

"use client";
import { useEffect } from "react";
import { CloseIcon, PlusIcon, SearchIcon, ShieldIcon, PlugIcon } from "@/components/icons/icons";
import Image from "next/image";
import { SessionTree } from "./SessionTree";
import { useSidebarStore } from "@/store/sidebarStore";
import { useAuthStore } from "@/store/authStore";
import { useMcpStore } from "@/store/mcpStore";
import { useUiStore } from "@/store/uiStore";
import { refreshSessions } from "@/lib/client/fetchSessions";

const AUTH_LABEL: Record<string, string> = { ready: "Signed in", needs_reauth: "Needs login", not_configured: "Not set up" };

export function Sidebar() {
  const { drawerOpen, setDrawerOpen, openSheet } = useUiStore();
  const { searchQuery, setSearchQuery } = useSidebarStore();
  const authStatus = useAuthStore((s) => s.status);
  const { servers, refresh: refreshMcp } = useMcpStore();

  useEffect(() => {
    refreshSessions();
    useAuthStore.getState().refresh();
    refreshMcp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectedCount = servers.filter((s) => s.status === "connected").length;
  const authLabel =
    authStatus?.state === "ready" && authStatus.email ? authStatus.email : AUTH_LABEL[authStatus?.state || ""] || "Checking…";

  return (
    <>
      {/* Mobile scrim */}
      <div
        onClick={() => setDrawerOpen(false)}
        className={`noise-overlay fixed inset-0 bg-black/45 z-20 transition-opacity md:hidden ${
          drawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        className={`fixed md:relative top-2 md:top-0 left-2 md:left-0 bottom-2 md:bottom-0 w-[min(288px,82vw)] md:w-72 z-21 md:z-auto bg-sidebar-bg backdrop-blur-3xl backdrop-saturate-150 border border-panel-border md:border-r md:border-t-0 md:border-b-0 md:border-l-0 rounded-xl md:rounded-none shadow-2xl md:shadow-none flex flex-col flex-none transition-transform duration-200 ${
          drawerOpen ? "translate-x-0" : "-translate-x-[calc(100%+16px)] md:translate-x-0"
        }`}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <Image
              src="/logo-gem-v4.png"
              alt="AwayAgent"
              width={26}
              height={26}
              className="w-[26px] h-[26px] rounded-lg flex-none object-cover shadow-[0_2px_6px_-1px_rgba(0,0,0,0.5)]"
            />
            <span className="text-[26px] leading-none" style={{ fontFamily: "var(--font-brand)" }}>
              AwayAgent
            </span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="md:hidden w-[34px] h-[34px] rounded-lg flex-none flex items-center justify-center text-text-2 hover:bg-hover"
          >
            <CloseIcon className="w-[17px] h-[17px]" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <button
            onClick={() => openSheet("newSession")}
            className="w-full flex items-center gap-2.5 py-2.5 px-3 my-1 mb-3.5 rounded-xl bg-panel-strong border border-panel-border text-text-1 text-[13.5px] font-medium hover:bg-[rgba(40,40,50,0.9)] hover:border-white/14 transition-colors"
          >
            <PlusIcon className="w-4 h-4 text-accent-2" />
            New session
          </button>

          <div className="flex items-center gap-2 mb-3.5 bg-black/22 border border-panel-border-soft rounded-lg py-2 px-2.5 focus-within:border-accent-soft-border">
            <SearchIcon className="w-3.5 h-3.5 flex-none text-text-3" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions…"
              className="flex-1 min-w-0 bg-transparent outline-none text-text-1 text-[13px] placeholder:text-text-3"
            />
          </div>

          <div className="text-[10.5px] font-bold tracking-widest uppercase text-text-3 px-1.5 mb-1.5">Workspace</div>
          <SessionTree />
        </div>

        <div className="p-3 border-t border-panel-border-soft flex flex-col gap-0.5">
          <button
            onClick={() => openSheet("auth")}
            className="flex items-center gap-2.5 w-full text-left rounded-xl py-2 px-2 hover:bg-hover transition-colors"
          >
            <span className={`w-[30px] h-[30px] rounded-[9px] flex-none flex items-center justify-center bg-panel-strong border border-panel-border-soft ${
              authStatus?.state === "ready" ? "text-success" : "text-warn"
            }`}>
              <ShieldIcon className="w-[15px] h-[15px]" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-medium text-text-1">Account</span>
              <span className="block text-[11px] text-text-3 overflow-hidden text-ellipsis whitespace-nowrap">{authLabel}</span>
            </span>
          </button>
          <button
            onClick={() => openSheet("mcp")}
            className="flex items-center gap-2.5 w-full text-left rounded-xl py-2 px-2 hover:bg-hover transition-colors"
          >
            <span className="w-[30px] h-[30px] rounded-[9px] flex-none flex items-center justify-center bg-panel-strong border border-panel-border-soft text-text-2">
              <PlugIcon className="w-[15px] h-[15px]" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-medium text-text-1">MCP servers</span>
              <span className="block text-[11px] text-text-3">{servers.length ? `${connectedCount}/${servers.length} connected` : "Loading…"}</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}

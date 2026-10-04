"use client";
import { useState } from "react";
import { FolderIcon, ChevronRightIcon, ChatIcon, PlusIcon, LaptopIcon } from "@/components/icons/icons";
import { Highlighted } from "./Highlighted";
import { useSidebarStore } from "@/store/sidebarStore";
import { useSessionStore } from "@/store/sessionStore";
import { switchProject } from "@/lib/client/switchProject";
import { timeAgo } from "@/lib/client/timeAgo";
import { splitSearchWords, matchesAllWords } from "@/lib/client/searchHighlight";
import { useEngineStore } from "@/store/engineStore";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import type { EngineRow, ProjectDirectory } from "@/lib/shared/ws-protocol";

function LiveDot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_2px_var(--color-success-soft)] flex-none" />;
}

const COLLAPSED_KEY = "away-agent:collapsedDevices";

// "Apple M1 Pro - 37ed…0ff9": the chip plus a shortened hardware fingerprint.
// Which Claude account this device runs sessions on (each device has its own).
function claudeAccountLine(engine: EngineRow | undefined): { text: string; warn: boolean } | null {
  const auth = engine?.claude_auth;
  if (!auth) return null;
  const servers = engine?.mcp?.servers ?? [];
  const mcp = servers.length ? ` · MCP ${servers.filter((s) => s.status === "connected").length}/${servers.length}` : "";
  if (auth.state === "ready") {
    return { text: `Claude: ${auth.email ?? "signed in"}${auth.subscriptionType ? ` · ${auth.subscriptionType}` : ""}${mcp}`, warn: false };
  }
  if (auth.state === "cli_missing") return { text: "Claude Code CLI not installed", warn: true };
  return { text: "Claude login needed", warn: true };
}

function deviceSubtitle(engine: EngineRow | undefined): string {
  if (!engine) return "unknown device";
  const chip = engine.model?.split(" · ").pop() ?? engine.platform ?? "";
  const fp = engine.fingerprint ? `${engine.fingerprint.slice(0, 4)}…${engine.fingerprint.slice(-4)}` : "";
  return [chip, fp].filter(Boolean).join(" - ");
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function SessionTree() {
  const directories = useSidebarStore((s) => s.directories);
  const searching = useSidebarStore((s) => s.searchQuery.trim().length > 0);
  const { engines, online } = useEngineStore();
  const openSheet = useUiStore((s) => s.openSheet);

  function manageLogin(engineId: string, deviceName: string) {
    useAuthStore.getState().setDevice(engineId, deviceName);
    openSheet("device");
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : loadCollapsed()));

  function toggleDevice(engineId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(engineId)) next.delete(engineId);
      else next.add(engineId);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // per-viewer convenience only
      }
      return next;
    });
  }

  // One group per device: online devices first, then by name.
  const byDevice = new Map<string, ProjectDirectory[]>();
  for (const dir of directories) {
    const key = dir.engineId ?? "";
    byDevice.set(key, [...(byDevice.get(key) ?? []), dir]);
  }
  const devices = [...byDevice.keys()].sort((a, b) => {
    const onlineDiff = Number(online.includes(b)) - Number(online.includes(a));
    return onlineDiff || (engines[a]?.device_name ?? a).localeCompare(engines[b]?.device_name ?? b);
  });

  return (
    <div>
      {devices.map((engineId) => {
        const engine = engines[engineId];
        const isOnline = online.includes(engineId);
        // Searching shows matches on every device, even ones you folded away.
        const open = searching || !collapsed.has(engineId);
        const account = claudeAccountLine(engine);
        return (
          <div key={engineId || "unknown"} className="mb-2">
            {/* One card: the collapse toggle and, under the Claude line, Manage. */}
            <div className="rounded-lg px-1.5 py-1.5 hover:bg-hover transition-colors">
              <button
                onClick={() => toggleDevice(engineId)}
                aria-expanded={open}
                title={engine?.fingerprint ? `Device fingerprint ${engine.fingerprint}` : undefined}
                className="w-full min-w-0 flex items-start gap-2 text-left"
              >
                {/* Top-aligned with the device name line (12.5px text, ~19px line). */}
                <span className={`flex flex-none mt-[4.5px] text-text-3 transition-transform ${open ? "rotate-90" : ""}`}>
                  <ChevronRightIcon className="w-[10px] h-[10px]" />
                </span>
                <LaptopIcon className={`w-[15px] h-[15px] flex-none mt-[2px] ${isOnline ? "text-text-2" : "text-text-3"}`} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`text-[12.5px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap ${isOnline ? "text-text-1" : "text-text-3"}`}>
                      {engine?.device_name || engineId || "Unknown device"}
                    </span>
                    {isOnline ? (
                      <span className="w-1.5 h-1.5 rounded-full flex-none bg-success" />
                    ) : (
                      <span className="flex-none text-[9.5px] font-semibold uppercase tracking-wider text-text-3 border border-panel-border-soft rounded px-1 py-px">
                        Offline
                      </span>
                    )}
                  </span>
                  <span className="block text-[10.5px] text-text-3 overflow-hidden text-ellipsis whitespace-nowrap">
                    {deviceSubtitle(engine)}
                    {!isOnline && engine ? ` · seen ${timeAgo(engine.last_seen_at)}` : ""}
                  </span>
                  {account && (
                    <span className={`block text-[10.5px] overflow-hidden text-ellipsis whitespace-nowrap ${account.warn ? "text-warn" : "text-text-3"}`}>
                      {account.text}
                    </span>
                  )}
                </span>
                {!open && <span className="flex-none mt-[2px] text-[10.5px] text-text-3">{byDevice.get(engineId)!.length}</span>}
              </button>
              {engine && (
                // Aligned with the text column: chevron (10) + gap (8) + icon (15) + gap (8).
                <div className="ml-[41px] mt-1.5">
                  <button
                    onClick={() => manageLogin(engineId, engine.device_name || engineId)}
                    title={isOnline ? "This device's Claude login and MCP servers" : "Device offline — view only; changes need it online"}
                    className={`w-full text-[10.5px] rounded-md px-2 py-1 border transition-colors ${
                      account?.warn
                        ? "text-warn border-warn/40 hover:bg-active"
                        : "text-text-3 border-panel-border-soft hover:text-text-1 hover:bg-active"
                    }`}
                  >
                    {account?.warn ? "Fix" : "Manage"}
                  </button>
                </div>
              )}
            </div>
            {/* Indented with a guide line so folders read as belonging to this device. */}
            {open && (
              <div className="ml-[13px] pl-2 border-l border-panel-border-soft">
                <DeviceFolders engineId={engineId} dirs={byDevice.get(engineId)!} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeviceFolders({ engineId, dirs }: { engineId: string; dirs: ProjectDirectory[] }) {
  const { searchQuery, expandedDirs, toggleExpanded } = useSidebarStore();
  const { currentProject, currentSessionId } = useSessionStore();
  const setPreferred = useEngineStore((s) => s.setPreferred);
  const words = splitSearchWords(searchQuery);

  return (
    <div>
      {dirs.map((dir) => {
        const folderName = dir.projectPath.split("/").pop() || dir.projectPath;
        const folderMatches = matchesAllWords(folderName, words);
        const visibleSessions = dir.sessions.filter((s) => words.length === 0 || matchesAllWords(s.title, words));
        const groupVisible = words.length === 0 || folderMatches || visibleSessions.length > 0;
        if (!groupVisible) return null;
        const dirKey = `${engineId}|${dir.projectPath}`;
        const expanded = words.length > 0 || expandedDirs.has(dirKey);

        return (
          <div key={dirKey} className="mb-0.5">
            <div
              onClick={() => toggleExpanded(dirKey)}
              className="flex items-center gap-2 py-2 px-1.5 rounded-lg cursor-pointer text-text-2 hover:bg-hover hover:text-text-1 transition-colors group"
            >
              <span className={`flex flex-none text-text-3 transition-transform ${expanded ? "rotate-90" : ""}`}>
                <ChevronRightIcon className="w-[11px] h-[11px]" />
              </span>
              <FolderIcon className="w-[15px] h-[15px] flex-none text-text-3" />
              {dir.live && <LiveDot />}
              <span className="flex-1 text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                <Highlighted text={folderName} words={words} />
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // A new session in this folder must run on this folder's device.
                  if (engineId) setPreferred(engineId);
                  switchProject(dir.projectPath, { forceNew: true });
                }}
                title="New session here"
                className="w-[22px] h-[22px] rounded-md flex-none flex items-center justify-center text-text-3 opacity-0 group-hover:opacity-100 hover:bg-active hover:text-text-1 transition-colors"
              >
                <PlusIcon className="w-[13px] h-[13px]" />
              </button>
            </div>
            {expanded && (
              <div className="pl-[21px] mt-px">
                {visibleSessions.length === 0 && (
                  <div className="text-[10.5px] text-text-3 py-1.5 px-2.5">No sessions yet</div>
                )}
                {visibleSessions.map((s) => {
                  const active = dir.projectPath === currentProject && s.sessionId === currentSessionId;
                  return (
                    <div
                      key={s.sessionId}
                      onClick={() => switchProject(dir.projectPath, { sessionId: s.sessionId, title: s.title })}
                      className={`flex items-start gap-2 py-1.5 px-2 rounded-lg cursor-pointer mb-px transition-colors ${
                        active ? "bg-accent-soft" : "hover:bg-hover"
                      }`}
                    >
                      <ChatIcon className={`w-[13px] h-[13px] mt-0.5 flex-none ${active ? "text-accent-2" : "text-text-3"}`} />
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-[12.5px] overflow-hidden text-ellipsis whitespace-nowrap ${
                            active ? "text-text-1" : "text-text-2"
                          }`}
                        >
                          <Highlighted text={s.title} words={words} />
                        </div>
                        <div className="text-[10.5px] text-text-3 mt-0.5 flex items-center gap-1.5">
                          {s.live && <LiveDot />}
                          {timeAgo(s.modified)} · {s.messageCount} msgs
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

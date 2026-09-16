"use client";
import { useEffect, useState } from "react";
import { Sheet, FieldLabel } from "./Sheet";
import { FolderIcon, PinIcon, ChevronRightIcon } from "@/components/icons/icons";
import { useUiStore } from "@/store/uiStore";
import { usePinnedDirsStore } from "@/store/pinnedDirsStore";
import { switchProject } from "@/lib/client/switchProject";

type BrowseResult = { path: string; parent: string | null; dirs: { name: string; path: string }[] };

function folderLabel(path: string): string {
  return path.split("/").pop() || path;
}

export function NewSessionSheet() {
  const { activeSheet, closeSheet } = useUiStore();
  const { pins, isPinned, toggle } = usePinnedDirsStore();
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [customPath, setCustomPath] = useState("");
  const open = activeSheet === "newSession";

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load(path?: string) {
    try {
      const res = await fetch(`/api/browse-dirs${path ? `?path=${encodeURIComponent(path)}` : ""}`);
      if (res.ok) setBrowse(await res.json());
    } catch (e) {
      console.error("failed to browse directories:", e);
    }
  }

  function start(path: string) {
    switchProject(path, { forceNew: true });
    closeSheet();
  }

  return (
    <Sheet open={open} onClose={closeSheet} title="New session">
      <FieldLabel>Pinned</FieldLabel>
      {pins.length === 0 && <div className="text-[12px] text-text-3 py-1">No pinned directories yet — pin any folder below.</div>}
      <div className="flex flex-col gap-0.5 mb-1">
        {pins.map((path) => (
          <div key={path} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-hover group">
            <button onClick={() => start(path)} className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer">
              <FolderIcon className="w-[14px] h-[14px] flex-none text-text-3" />
              <span className="flex-1 min-w-0 text-[13px] text-text-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {folderLabel(path)}
              </span>
              <span className="text-[10.5px] text-text-3 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{path}</span>
            </button>
            <button
              onClick={() => toggle(path)}
              title="Unpin"
              className="flex-none w-[22px] h-[22px] rounded-md flex items-center justify-center text-accent-2 opacity-0 group-hover:opacity-100 hover:bg-active transition-opacity"
            >
              <PinIcon className="w-[13px] h-[13px]" fill="currentColor" />
            </button>
          </div>
        ))}
      </div>

      <FieldLabel>Browse</FieldLabel>
      {browse && (
        <div className="bg-black/22 border border-panel-border-soft rounded-lg overflow-hidden mb-1">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-panel-border-soft">
            {browse.parent && (
              <button
                onClick={() => load(browse.parent!)}
                title="Up one level"
                className="flex-none w-[22px] h-[22px] rounded-md flex items-center justify-center text-text-2 hover:bg-active hover:text-text-1"
              >
                <ChevronRightIcon className="w-[12px] h-[12px] rotate-180" />
              </button>
            )}
            <span className="flex-1 min-w-0 text-[11.5px] text-text-2 overflow-hidden text-ellipsis whitespace-nowrap" title={browse.path}>
              {browse.path}
            </span>
            <button
              onClick={() => start(browse.path)}
              className="flex-none text-[11px] font-medium text-accent-2 hover:text-accent px-2 py-1 rounded-md hover:bg-active"
            >
              Start here
            </button>
          </div>
          <div className="max-h-[220px] overflow-y-auto">
            {browse.dirs.length === 0 && <div className="text-[12px] text-text-3 py-3 px-2.5">No subdirectories</div>}
            {browse.dirs.map((d) => (
              <div key={d.path} className="flex items-center gap-1 group">
                <button
                  onClick={() => load(d.path)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left py-1.5 px-2.5 hover:bg-hover cursor-pointer"
                >
                  <FolderIcon className="w-[13px] h-[13px] flex-none text-text-3" />
                  <span className="flex-1 min-w-0 text-[12.5px] text-text-1 overflow-hidden text-ellipsis whitespace-nowrap">{d.name}</span>
                </button>
                <button
                  onClick={() => toggle(d.path)}
                  title={isPinned(d.path) ? "Unpin" : "Pin"}
                  className={`flex-none w-[22px] h-[22px] mr-1.5 rounded-md flex items-center justify-center transition-opacity ${
                    isPinned(d.path) ? "text-accent-2 opacity-100" : "text-text-3 opacity-0 group-hover:opacity-100"
                  } hover:bg-active`}
                >
                  <PinIcon className="w-[12px] h-[12px]" fill={isPinned(d.path) ? "currentColor" : "none"} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <FieldLabel>Or type a path</FieldLabel>
      <div className="flex gap-1.5">
        <input
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customPath.trim()) start(customPath.trim());
          }}
          placeholder="/path/to/project"
          className="flex-1 min-w-0 bg-black/22 border border-panel-border-soft rounded-lg py-2 px-2.5 text-[12.5px] text-text-1 placeholder:text-text-3 outline-none focus:border-accent-soft-border"
        />
        <button
          onClick={() => customPath.trim() && start(customPath.trim())}
          className="flex-none px-3.5 rounded-lg bg-panel-strong border border-panel-border-soft text-text-2 hover:text-text-1 text-[12.5px] font-medium transition-colors"
        >
          Start
        </button>
      </div>
    </Sheet>
  );
}

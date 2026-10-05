"use client";
import { useEffect, useState } from "react";
import { Sheet, FieldLabel } from "./Sheet";
import { Button, IconButton, TextInput, cx } from "@/components/ui";
import { FolderIcon, PinIcon, ChevronRightIcon } from "@/components/icons/icons";
import { useUiStore } from "@/store/uiStore";
import { usePinnedDirsStore } from "@/store/pinnedDirsStore";
import { switchProject } from "@/lib/client/switchProject";
import { browseDirs, type BrowseResult } from "@/lib/client/hub";
import { useEngineStore, selectedEngineId } from "@/store/engineStore";

function folderLabel(path: string): string {
  return path.split("/").pop() || path;
}

export function NewSessionSheet() {
  const { activeSheet, closeSheet } = useUiStore();
  const { pins, isPinned, toggle } = usePinnedDirsStore();
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const { online, setPreferred } = useEngineStore();
  const engineId = online.length ? selectedEngineId() : null;
  const open = activeSheet === "newSession";

  useEffect(() => {
    if (open && engineId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engineId]);

  async function load(path?: string) {
    setBrowseError(null);
    try {
      setBrowse(await browseDirs(path));
    } catch (e) {
      setBrowseError((e as Error).message);
    }
  }

  function start(path: string) {
    if (!engineId) return;
    switchProject(path, { forceNew: true });
    closeSheet();
  }

  return (
    <Sheet open={open} onClose={closeSheet} title="New session">
      {!engineId ? (
        <div className="text-[12.5px] text-warn mb-3">
          No device is online. New sessions need a running engine — start one with <code>npm run engine</code>.
        </div>
      ) : (
        online.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11.5px] text-text-3 mr-1">Run on</span>
            {online.map((id) => (
              <button
                key={id}
                onClick={() => {
                  setPreferred(id);
                  setBrowse(null);
                }}
                className={`text-[11.5px] rounded-full px-2.5 py-1 border transition-colors ${
                  id === engineId ? "border-accent-soft-border text-accent-2 bg-active" : "border-panel-border-soft text-text-2 hover:text-text-1"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )
      )}
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
            <IconButton
              size={22}
              radius="md"
              tone="accent"
              className="opacity-0 group-hover:opacity-100"
              title="Unpin"
              aria-label="Unpin"
              onClick={() => toggle(path)}
            >
              <PinIcon className="w-[13px] h-[13px]" fill="currentColor" />
            </IconButton>
          </div>
        ))}
      </div>

      <FieldLabel>Browse{engineId ? ` · ${engineId}` : ""}</FieldLabel>
      {browseError && <div className="text-[12px] text-danger py-1">{browseError}</div>}
      {engineId && !browse && !browseError && <div className="text-[12px] text-text-3 py-1">Asking the device…</div>}
      {engineId && browse && (
        <div className="bg-black/22 border border-panel-border-soft rounded-lg overflow-hidden mb-1">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-panel-border-soft">
            {browse.parent && (
              <IconButton size={22} radius="md" title="Up one level" aria-label="Up one level" onClick={() => load(browse.parent!)}>
                <ChevronRightIcon className="w-[12px] h-[12px] rotate-180" />
              </IconButton>
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
                <IconButton
                  size={22}
                  radius="md"
                  tone={isPinned(d.path) ? "accent" : "muted"}
                  className={cx("mr-1.5", isPinned(d.path) ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                  title={isPinned(d.path) ? "Unpin" : "Pin"}
                  aria-label={isPinned(d.path) ? "Unpin" : "Pin"}
                  onClick={() => toggle(d.path)}
                >
                  <PinIcon className="w-[12px] h-[12px]" fill={isPinned(d.path) ? "currentColor" : "none"} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}

      <FieldLabel>Or type a path</FieldLabel>
      <div className="flex gap-1.5">
        <TextInput
          fieldSize="xs"
          className="flex-1 min-w-0"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customPath.trim()) start(customPath.trim());
          }}
          placeholder="/path/to/project"
        />
        <Button variant="secondary" size="field" className="flex-none" onClick={() => customPath.trim() && start(customPath.trim())}>
          Start
        </Button>
      </div>
    </Sheet>
  );
}

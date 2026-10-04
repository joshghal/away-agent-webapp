"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "@/components/icons/icons";

type Option = { value: string; label: string; description?: string };

// Headless — no real <select> underneath at all. The original kept a hidden real
// <select> specifically so vanilla JS could treat it as a .value/change-event
// source of truth; a controlled React component removes the reason for that
// scaffolding entirely. Basic keyboard handling added since the original had none.
export function Dropdown({
  value,
  options,
  onChange,
  compact = false,
  openUpward = false,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  compact?: boolean;
  openUpward?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${compact ? "flex-none min-w-0 max-w-[92px]" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={
          compact
            ? "flex w-full items-center justify-between gap-1.5 rounded-full bg-panel py-1.5 pl-3 pr-2 text-xs text-text-1 border border-panel-border-soft hover:border-white/18 transition-colors overflow-hidden"
            : "flex w-full items-center justify-between gap-2.5 rounded-lg bg-black/22 py-2.5 px-2.5 text-[13px] text-text-1 border border-panel-border-soft hover:border-white/18 transition-colors"
        }
      >
        <span className={compact ? "overflow-hidden text-ellipsis whitespace-nowrap" : ""}>{current?.label}</span>
        <ChevronRightIcon className={`w-3.5 h-3.5 flex-none text-text-3 transition-transform rotate-90 ${open ? "!rotate-[270deg]" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute z-10 rounded-lg border border-panel-border bg-[rgba(28,28,36,0.98)] p-1 shadow-2xl max-h-56 overflow-y-auto ${
            compact ? "left-0 w-max min-w-[140px]" : "left-0 right-0"
          } ${openUpward ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`px-2.5 py-2 rounded-md text-[13px] whitespace-nowrap cursor-pointer transition-colors ${
                opt.value === value ? "bg-accent-soft text-text-1" : "text-text-2 hover:bg-hover hover:text-text-1"
              }`}
            >
              {opt.label}
              {opt.description && <div className="text-[10.5px] text-text-3 mt-0.5">{opt.description}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

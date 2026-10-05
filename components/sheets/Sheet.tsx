"use client";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/icons/icons";
import { IconButton } from "@/components/ui";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open || typeof document === "undefined") return null;
  // Rendered via a portal straight to <body> rather than in place — AppShell's
  // glass panel has `backdrop-filter`, which (like `filter`/`transform`) creates a
  // new containing block for any `position: fixed` descendant. Without the
  // portal, this sheet's fixed overlay would position itself relative to that
  // panel instead of the real viewport — confirmed: that's exactly what produced
  // the cropped, misaligned overlay seen before this fix.
  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="noise-overlay fixed inset-0 z-30 bg-black/55 backdrop-blur-sm flex items-end sm:items-center justify-center"
    >
      {/* Fixed-height flex column: the header is a non-scrolling row and only the
          body scrolls — a scrollbar spanning the whole card, including the
          header, looked wrong and made the header feel scrollable when it isn't. */}
      <div className="w-full max-w-[560px] max-h-[82vh] flex flex-col overflow-hidden bg-sheet-bg border border-panel-border rounded-t-[20px] sm:rounded-2xl shadow-2xl sm:mb-[6vh]">
        <div className="flex-none flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="m-0 text-[26px] leading-none" style={{ fontFamily: "var(--font-brand)" }}>
            {title}
          </h3>
          <IconButton onClick={onClose} aria-label="Close">
            <CloseIcon className="w-[17px] h-[17px]" />
          </IconButton>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-[11.5px] font-semibold tracking-wide text-text-3 mt-4 mb-1.5 first:mt-1">{children}</label>;
}

"use client";
import { useEffect, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useLandingCentering } from "@/hooks/useLandingCentering";
import { ChatEntryView } from "./ChatEntryView";
import { InputBar } from "./InputBar";
import { SendIcon } from "@/components/icons/icons";
import { loadOlderHistory } from "@/lib/client/hub";

export function ChatArea() {
  const entries = useChatStore((s) => s.entries);
  const { hasOlder, loadingOlder, loading, shown, total } = useChatStore((s) => s.historyMeta);
  const fmt = (n: number) => n.toLocaleString();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Prepending older messages must not yank the view: keep the same message under the eye.
  async function loadOlder() {
    const el = logRef.current;
    if (!el) return;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    await loadOlderHistory();
    requestAnimationFrame(() => {
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
    });
  }

  // Scrolling up to the top loads the previous page automatically.
  useEffect(() => {
    const el = topRef.current;
    if (!el || !hasOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadOlder();
      },
      { root: logRef.current, rootMargin: "200px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOlder, entries.length]);

  const { forceScrollDown, showJumpButton } = useAutoScroll(logRef, [entries]);
  useLandingCentering(logRef, inputRef, entries.length === 0);

  return (
    <>
      {(loading || loadingOlder) && (
        <div className="relative h-0.5 flex-none overflow-hidden bg-transparent" role="progressbar" aria-label="Loading conversation">
          <div className="absolute inset-y-0 w-1/3 bg-accent-2/80 rounded-full animate-loadbar" />
        </div>
      )}
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pt-2 pb-5">
        <div className="max-w-[740px] mx-auto">
          {loading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-text-3" role="status" aria-live="polite">
              <span className="w-[18px] h-[18px] rounded-full border-2 border-white/15 border-t-text-1 animate-spin-slow" />
              <span className="text-[13px] text-text-2">Loading conversation…</span>
              {total ? <span className="text-[11.5px]">latest {fmt(Math.min(200, total))} of {fmt(total)} messages</span> : null}
            </div>
          )}
          {hasOlder && (
            <div ref={topRef} className="flex flex-col items-center gap-1 py-3">
              {total ? (
                <span className="text-[11px] text-text-3">
                  Showing {fmt(shown)} of {fmt(total)} messages
                </span>
              ) : null}
              <button
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="flex items-center gap-2 text-[12px] text-text-3 hover:text-text-1 border border-panel-border-soft rounded-full px-3 py-1 transition-colors disabled:opacity-60"
              >
                {loadingOlder && <span className="w-[10px] h-[10px] rounded-full border-[1.5px] border-white/15 border-t-text-2 animate-spin-slow" />}
                {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {entries.map((entry) => (
            <ChatEntryView key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
      {showJumpButton && (
        <button
          onClick={forceScrollDown}
          aria-label="Jump to latest message"
          title="Jump to latest message"
          className="absolute z-10 bottom-24 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-panel-strong border border-panel-border text-text-2 shadow-2xl hover:text-text-1 hover:border-white/16 transition-colors animate-message-in"
        >
          <SendIcon className="w-4 h-4 rotate-180" />
        </button>
      )}
      <InputBar ref={inputRef} />
    </>
  );
}

"use client";
import { useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useLandingCentering } from "@/hooks/useLandingCentering";
import { ChatEntryView } from "./ChatEntryView";
import { InputBar } from "./InputBar";
import { SendIcon } from "@/components/icons/icons";

export function ChatArea() {
  const entries = useChatStore((s) => s.entries);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  const { forceScrollDown, showJumpButton } = useAutoScroll(logRef, [entries]);
  useLandingCentering(logRef, inputRef, entries.length === 0);

  return (
    <>
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pt-2 pb-5">
        <div className="max-w-[740px] mx-auto">
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

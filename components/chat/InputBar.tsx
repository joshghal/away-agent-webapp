"use client";
import { forwardRef, useState } from "react";
import { SendIcon } from "@/components/icons/icons";
import { InlineSettingsDropdowns } from "@/components/settings/SettingsDropdowns";
import { DevicePicker } from "./DevicePicker";
import { send } from "@/lib/client/hub";
import { useChatStore } from "@/store/chatStore";
import { useConnectionStore } from "@/store/connectionStore";
import { useSessionStore } from "@/store/sessionStore";
import { useTabsStore } from "@/store/tabsStore";

export const InputBar = forwardRef<HTMLDivElement>(function InputBar(_props, ref) {
  const [text, setText] = useState("");
  const status = useConnectionStore((s) => s.status);

  function sendMessage() {
    const trimmed = text.trim();
    if (!trimmed || status !== "connected") return;
    // A brand-new session's tab starts labeled with the bare project folder
    // name (there's no real title yet) — the first message is the earliest
    // point a better one exists, so promote it into the tab label right away
    // rather than waiting on a server round trip.
    if (useChatStore.getState().entries.length === 0) {
      const { currentProject, currentSessionId } = useSessionStore.getState();
      if (currentProject) useTabsStore.getState().upsertTab(currentProject, currentSessionId, trimmed);
    }
    useChatStore.getState().appendUserMessage(trimmed);
    send({ type: "user_message", text: trimmed });
    // Immediate feedback that the message actually left the browser — the
    // "working" event (confirmation it reached Claude) updates this same
    // indicator moments later; real content replaces it once generation begins.
    useChatStore.getState().showWorkingIndicator("Sent — waiting for Claude…");
    setText("");
  }

  return (
    <div ref={ref} className="input-ease px-5 pt-3 pb-4 flex-none">
      <div className="max-w-[740px] mx-auto bg-panel-strong border border-panel-border rounded-2xl pt-2.5 px-2.5 pb-2 shadow-2xl">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask anything…"
          className="w-full resize-none border-none bg-transparent outline-none text-text-1 text-[15.5px] font-sans pt-1 pb-2 max-h-40 placeholder:text-text-3"
        />
        <div className="flex items-center gap-1.5 flex-wrap" style={{ rowGap: "8px" }}>
          <DevicePicker />
          <InlineSettingsDropdowns />
          <div className="flex-1" />
          <button
            onClick={sendMessage}
            disabled={status !== "connected"}
            aria-label="Send"
            className="w-[34px] h-[34px] rounded-full flex-none flex items-center justify-center text-white transition-transform active:scale-90 disabled:bg-none disabled:bg-white/8 disabled:text-text-3 disabled:active:scale-100 disabled:cursor-not-allowed bg-gradient-to-br from-accent-2 to-accent-strong"
          >
            <SendIcon className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>
    </div>
  );
});

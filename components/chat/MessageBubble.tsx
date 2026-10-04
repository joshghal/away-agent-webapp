"use client";
import { renderMarkdown } from "@/lib/client/renderMarkdown";
import Image from "next/image";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-6 animate-message-in">
      <div className="inline-block max-w-[82%] text-left whitespace-pre-wrap text-text-1 px-3.5 py-2.5 rounded-[16px_16px_4px_16px] bg-gradient-to-b from-accent/32 to-accent-strong/22 border border-accent/28">
        {text}
      </div>
    </div>
  );
}

// Always sanitized: the reply may quote attacker-written text (see renderMarkdown).
export function AssistantMessage({ text }: { text: string }) {
  const html = renderMarkdown(text);
  return (
    <div className="flex gap-3 items-start mb-6 animate-message-in">
      <Image
        src="/logo-gem-v4.png"
        alt=""
        width={26}
        height={26}
        className="w-[26px] h-[26px] rounded-lg flex-none mt-px object-cover shadow-[0_2px_6px_-1px_rgba(0,0,0,0.45)]"
      />
      <div
        className="flex-1 min-w-0 pt-0.5 text-text-1 prose-chat"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

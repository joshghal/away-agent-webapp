"use client";
import { useState } from "react";
import { useSessionStore } from "@/store/sessionStore";

function Chip({ text, copyValue }: { text: string; copyValue: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // navigator.clipboard requires a secure context (HTTPS/localhost),
    // so it may not exist (older browsers, insecure contexts).
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(copyValue);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = copyValue;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      console.error("copy failed:", e);
    }
  }

  return (
    <span
      onClick={copy}
      title="Tap to copy"
      className={`flex-none font-mono text-[10.5px] rounded-md py-1 px-2 whitespace-nowrap cursor-pointer border transition-colors ${
        copied ? "text-success border-success/35" : "text-text-3 border-panel-border-soft bg-panel-strong hover:text-text-2"
      }`}
    >
      {copied ? "copied!" : text}
    </span>
  );
}

export function SessionInfoChips() {
  const { currentProject, currentSessionId } = useSessionStore();
  if (!currentProject) return null;
  return (
    <div className="flex gap-1.5 px-4 pb-2.5 overflow-x-auto flex-none">
      <Chip text={currentProject} copyValue={currentProject} />
      <Chip
        text={currentSessionId ? currentSessionId.slice(0, 8) + "…" : "no session id yet"}
        copyValue={currentSessionId || ""}
      />
    </div>
  );
}

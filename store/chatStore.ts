import { create } from "zustand";
import type { HistoryItem, ImagePart } from "@/lib/shared/ws-protocol";

export type ChatEntry =
  | { kind: "user_message"; id: string; text: string }
  | { kind: "assistant_text"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; done: boolean; collapsed: boolean }
  | { kind: "tool_use"; id: string; toolUseId: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; toolUseId: string; content: string; images: ImagePart[]; isError: boolean }
  | {
      kind: "approval";
      id: string;
      requestId: string;
      toolName: string;
      input: unknown;
      description?: string;
      resolved: "pending" | "allowed" | "denied";
    }
  | { kind: "working_indicator"; id: "working"; text: string }
  | { kind: "stall_warning"; id: "stall"; text: string };

// loading: first page in flight · shown/total: messages loaded vs in the session
export type HistoryMeta = { hasOlder: boolean; loadingOlder: boolean; loading: boolean; shown: number; total: number | null };
const EMPTY_META: HistoryMeta = { hasOlder: false, loadingOlder: false, loading: false, shown: 0, total: null };

let counter = 0;
const nextId = () => `entry-${Date.now()}-${counter++}`;

type ChatState = {
  entries: ChatEntry[];
  // Long sessions load their latest messages first; older ones on demand.
  historyMeta: HistoryMeta;
  setHistoryMeta: (meta: Partial<HistoryMeta>) => void;
  reset: () => void;
  // keys: stable ids (e.g. the event's database id) so re-renders reuse DOM.
  loadHistory: (items: HistoryItem[], keys?: string[]) => void;
  appendUserMessage: (text: string) => void;
  appendAssistantDelta: (text: string) => void;
  appendStandaloneAssistantText: (text: string) => void;
  appendThinkingDelta: (text: string) => void;
  finalizeThinking: () => void;
  finalizeStreamingText: () => void;
  addToolUse: (toolUseId: string, name: string, input: unknown) => void;
  addToolResult: (toolUseId: string, content: string, images: ImagePart[], isError: boolean) => void;
  addApprovalRequest: (requestId: string, toolName: string, input: unknown, description?: string) => void;
  resolveApproval: (requestId: string, allow: boolean) => void;
  showWorkingIndicator: (text: string) => void;
  hideWorkingIndicator: () => void;
  showStallWarning: (text: string) => void;
  hideStallWarning: () => void;
  onTurnComplete: () => void;
};

function withoutFixed(entries: ChatEntry[], id: "working" | "stall"): ChatEntry[] {
  return entries.filter((e) => e.id !== id);
}

export const useChatStore = create<ChatState>((set, get) => ({
  entries: [],
  historyMeta: EMPTY_META,
  setHistoryMeta: (meta) => set((s) => ({ historyMeta: { ...s.historyMeta, ...meta } })),

  reset: () => set({ entries: [], historyMeta: EMPTY_META }),

  loadHistory: (items, keys) => {
    const entries: ChatEntry[] = [];
    items.forEach((item, i) => {
      const id = keys?.[i] ?? nextId();
      if (item.type === "user_message") {
        entries.push({ kind: "user_message", id, text: item.text || "" });
      } else if (item.type === "assistant_text") {
        entries.push({ kind: "assistant_text", id, text: item.text, streaming: false });
      } else if (item.type === "tool_use") {
        entries.push({ kind: "tool_use", id, toolUseId: item.id, name: item.name, input: item.input });
      } else if (item.type === "tool_result") {
        entries.push({
          kind: "tool_result",
          id,
          toolUseId: item.tool_use_id,
          content: item.content,
          images: item.images,
          isError: item.is_error,
        });
      }
    });
    set({ entries });
  },

  appendUserMessage: (text) => {
    get().finalizeStreamingText();
    set((s) => ({ entries: [...s.entries, { kind: "user_message", id: nextId(), text }] }));
  },

  // Deltas are contiguous fragments of one continuous stream — concatenate
  // directly onto the last entry if it's still streaming, no separator.
  appendAssistantDelta: (text) => {
    get().finalizeThinking();
    set((s) => {
      const entries = withoutFixed(s.entries, "working");
      const last = entries[entries.length - 1];
      if (last && last.kind === "assistant_text" && last.streaming) {
        return { entries: [...entries.slice(0, -1), { ...last, text: last.text + text }] };
      }
      return { entries: [...entries, { kind: "assistant_text", id: nextId(), text, streaming: true }] };
    });
  },

  appendStandaloneAssistantText: (text) => {
    set((s) => ({ entries: [...s.entries, { kind: "assistant_text", id: nextId(), text, streaming: false }] }));
  },

  appendThinkingDelta: (text) => {
    set((s) => {
      const entries = withoutFixed(s.entries, "working");
      const last = entries[entries.length - 1];
      if (last && last.kind === "thinking" && !last.done) {
        return { entries: [...entries.slice(0, -1), { ...last, text: last.text + text }] };
      }
      return { entries: [...entries, { kind: "thinking", id: nextId(), text, done: false, collapsed: false }] };
    });
  },

  finalizeThinking: () => {
    set((s) => {
      const idx = s.entries.findIndex((e) => e.kind === "thinking" && !e.done);
      if (idx === -1) return s;
      const entries = [...s.entries];
      const entry = entries[idx];
      if (entry.kind === "thinking") entries[idx] = { ...entry, done: true, collapsed: true };
      return { entries };
    });
  },

  // Marks any still-streaming assistant text as finalized, so the next delta
  // starts a fresh bubble rather than appending to text from before an
  // interrupting tool_use/user_message/turn_complete.
  finalizeStreamingText: () => {
    set((s) => {
      const idx = s.entries.findIndex((e) => e.kind === "assistant_text" && e.streaming);
      if (idx === -1) return s;
      const entries = [...s.entries];
      const entry = entries[idx];
      if (entry.kind === "assistant_text") entries[idx] = { ...entry, streaming: false };
      return { entries };
    });
  },

  addToolUse: (toolUseId, name, input) => {
    get().finalizeThinking();
    get().finalizeStreamingText();
    set((s) => ({
      entries: [...withoutFixed(s.entries, "working"), { kind: "tool_use", id: nextId(), toolUseId, name, input }],
    }));
  },

  addToolResult: (toolUseId, content, images, isError) => {
    set((s) => ({ entries: [...s.entries, { kind: "tool_result", id: nextId(), toolUseId, content, images, isError }] }));
  },

  addApprovalRequest: (requestId, toolName, input, description) => {
    set((s) => ({
      entries: [
        ...s.entries,
        { kind: "approval", id: nextId(), requestId, toolName, input, description, resolved: "pending" },
      ],
    }));
  },

  resolveApproval: (requestId, allow) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.kind === "approval" && e.requestId === requestId ? { ...e, resolved: allow ? "allowed" : "denied" } : e
      ),
    }));
  },

  showWorkingIndicator: (text) => {
    set((s) => {
      const entries = withoutFixed(s.entries, "working");
      return { entries: [...entries, { kind: "working_indicator", id: "working", text }] };
    });
  },

  hideWorkingIndicator: () => {
    get().hideStallWarning();
    set((s) => ({ entries: withoutFixed(s.entries, "working") }));
  },

  showStallWarning: (text) => {
    set((s) => ({ entries: [...withoutFixed(s.entries, "stall"), { kind: "stall_warning", id: "stall", text }] }));
  },

  hideStallWarning: () => set((s) => ({ entries: withoutFixed(s.entries, "stall") })),

  onTurnComplete: () => {
    get().finalizeThinking();
    get().finalizeStreamingText();
    get().hideWorkingIndicator();
  },
}));

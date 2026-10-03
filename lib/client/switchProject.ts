import { useSessionStore } from "@/store/sessionStore";
import { useChatStore } from "@/store/chatStore";
import { useTabsStore, tabKey } from "@/store/tabsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useTabStatusStore } from "@/store/tabStatusStore";
import { sendInit, engineFor } from "@/lib/client/hub";

export function switchProject(path: string, opts: { sessionId?: string; forceNew?: boolean; title?: string } = {}): void {
  if (!path) return;
  const { sessionId, forceNew, title } = opts;
  const resolvedSessionId = forceNew ? null : sessionId || null;

  useSessionStore.getState().setSession(path, resolvedSessionId, false, engineFor(path, resolvedSessionId));
  useChatStore.getState().reset();
  useSidebarStore.getState().expand(`${engineFor(path, resolvedSessionId) ?? ""}|${path}`);
  // Visiting a tab resolves its "unread" (finished while you weren't looking)
  // badge back to plain idle — the underlying status hasn't changed, only its
  // visibility has. Leave processing/permission alone; those are still true.
  const key = tabKey(path, resolvedSessionId);
  if (useTabStatusStore.getState().byKey[key] === "unread") {
    useTabStatusStore.getState().setStatus(key, "idle");
  }
  // Optimistic: add/activate the tab immediately on click rather than waiting for
  // the server to confirm via session_init — that round trip can be slow, and
  // session_init's own call to upsertTab (idempotent) just confirms/corrects this.
  // `title`, when the caller has it (e.g. clicking an existing session in the
  // sidebar), becomes the tab's label instead of the bare project folder name.
  useTabsStore.getState().upsertTab(path, resolvedSessionId, title);

  sendInit({ project: path, sessionId, forceNew });
}

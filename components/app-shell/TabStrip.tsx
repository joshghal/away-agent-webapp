"use client";
import { CloseIcon } from "@/components/icons/icons";
import { IconButton } from "@/components/ui";
import { useTabsStore, tabKey } from "@/store/tabsStore";
import { useSessionStore } from "@/store/sessionStore";
import { useChatStore } from "@/store/chatStore";
import { useConnectionStore } from "@/store/connectionStore";
import { useTabStatusStore } from "@/store/tabStatusStore";
import { switchProject } from "@/lib/client/switchProject";
import { send, engineFor, refreshConnectionStatus } from "@/lib/client/hub";
import { refreshSessions } from "@/lib/client/fetchSessions";
import { updateUrlForCurrent } from "@/lib/client/urlSync";

const STATUS_DOT_CLASS = {
  idle: "bg-text-3",
  processing: "bg-accent-2 animate-turn-pulse",
  permission: "bg-warn animate-turn-pulse",
  // Solid, not pulsing — nothing is actively happening, it's just unseen.
  unread: "bg-success",
} as const;

const STATUS_LABEL = {
  idle: "Idle",
  processing: "Processing",
  permission: "Needs permission",
  unread: "Finished — not yet viewed",
} as const;

export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const { currentProject, currentSessionId } = useSessionStore();
  const statusByKey = useTabStatusStore((s) => s.byKey);
  if (tabs.length === 0) return null;
  const activeKey = tabKey(currentProject || "", currentSessionId);

  function handleClose(e: React.MouseEvent, key: string, project: string, sessionId: string | null) {
    e.stopPropagation();
    const next = useTabsStore.getState().closeTab(key);
    // Closing a tab stops the underlying process on its device, not just hides it
    // from this list — sent by project since the closed tab might not be the one
    // this viewer is actively looking at.
    void send({ type: "kill_session", project }, engineFor(project, sessionId));
    if (key === activeKey) {
      if (next) {
        switchProject(next.project, { sessionId: next.sessionId || undefined });
      } else {
        // Closed the only open tab — actually land at zero tabs / a blank landing
        // state, not a freshly-spawned replacement tab for the same project (that
        // was the previous bug: switchProject's own upsertTab call put a tab right
        // back the instant this one was removed, so closing the last tab visibly
        // did nothing). Also clear lastInit so a future reconnect doesn't silently
        // resurrect this project — see the comment on connectionStore.lastInit.
        useChatStore.getState().reset();
        useSessionStore.getState().clearSession();
        useConnectionStore.getState().setLastInit(null);
        refreshConnectionStatus();
        updateUrlForCurrent(null, null);
      }
    }
    // The sidebar's live dot is only as fresh as the last sessions fetch —
    // closing a tab that ISN'T the active one (so nothing above re-triggers a
    // session_init) would otherwise leave it showing live until some unrelated
    // refresh happens. Give killLive a moment to land, then re-check.
    setTimeout(refreshSessions, 300);
  }

  return (
    <div className="flex items-end gap-[3px] px-3 pt-2 flex-none overflow-x-auto bg-black/16 border-b border-panel-border-soft">
      {tabs.map((t) => {
        const key = tabKey(t.project, t.sessionId);
        const active = key === activeKey;
        const status = statusByKey[key] || "idle";
        return (
          <div
            key={key}
            onClick={() => switchProject(t.project, { sessionId: t.sessionId || undefined })}
            className={`flex items-center gap-1.5 flex-none max-w-[170px] py-2 pt-2 pl-3.5 pr-1.5 text-[12.5px] rounded-t-[10px] border border-b-0 border-panel-border-soft cursor-pointer transition-colors ${
              active ? "bg-transparent text-text-1" : "bg-white/3 text-text-3"
            }`}
          >
            <span title={STATUS_LABEL[status]} className={`w-1.5 h-1.5 rounded-full flex-none ${STATUS_DOT_CLASS[status]}`} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{t.label}</span>
            <IconButton
              size={18}
              radius="full"
              tone="muted"
              title="Close tab"
              aria-label="Close tab"
              onClick={(e) => handleClose(e, key, t.project, t.sessionId)}
            >
              <CloseIcon className="w-2.5 h-2.5" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

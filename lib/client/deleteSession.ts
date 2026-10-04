import { supabase } from "@/lib/client/supabase";
import { deleteSessionFile } from "@/lib/client/hub";
import { refreshSessions } from "@/lib/client/fetchSessions";
import { useSessionStore } from "@/store/sessionStore";
import { useChatStore } from "@/store/chatStore";
import { useTabsStore, tabKey } from "@/store/tabsStore";
import { updateUrlForCurrent } from "@/lib/client/urlSync";

// Permanently deletes a session: the device's transcript file (killing it first
// if it's live), then the `sessions` DB row (owner-only; cascades to
// session_events). That order matters — deleting the DB row first and the file
// delete failing (device offline, etc.) would leave an orphaned local file for
// the engine's own transcript re-scan to resurrect as a "new" session later.
export async function deleteSession(engineId: string, project: string, sessionId: string): Promise<void> {
  await deleteSessionFile(engineId, project, sessionId);

  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);

  const key = tabKey(project, sessionId);
  useTabsStore.getState().closeTab(key);

  const session = useSessionStore.getState();
  if (session.currentProject === project && session.currentSessionId === sessionId) {
    session.clearSession();
    useChatStore.getState().reset();
    updateUrlForCurrent(null, null);
  }

  void refreshSessions();
}

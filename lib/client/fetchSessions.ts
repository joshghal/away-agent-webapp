import { supabase } from "./supabase";
import { useSidebarStore } from "@/store/sidebarStore";
import { useTabStatusStore } from "@/store/tabStatusStore";
import { useTabsStore, tabKey } from "@/store/tabsStore";
import { useEngineStore, isEngineOnline } from "@/store/engineStore";
import type { ProjectDirectory, SessionRow, SessionSummary } from "@/lib/shared/ws-protocol";

const SESSIONS_PER_PROJECT = 25;

export async function refreshSessions(): Promise<ProjectDirectory[] | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, project_path, title, engine_id, status, unread, live, message_count, last_message_at, updated_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) {
    console.error("failed to load sessions:", error.message);
    return null;
  }

  // Grouped per device + folder: the same path on two machines is two different folders.
  const groupKey = (engineId: string | null, path: string) => `${engineId ?? ""}|${path}`;
  const byProject = new Map<string, { engineId: string | null; projectPath: string; sessions: SessionSummary[] }>();
  for (const row of data as SessionRow[]) {
    const key = groupKey(row.engine_id, row.project_path);
    const group = byProject.get(key) ?? { engineId: row.engine_id, projectPath: row.project_path, sessions: [] };
    const list = group.sessions;
    if (list.length >= SESSIONS_PER_PROJECT) continue;
    // A "live" flag left behind by a device that has since gone offline isn't live.
    const live = row.live && isEngineOnline(row.engine_id);
    list.push({
      sessionId: row.id,
      engineId: row.engine_id,
      title: row.title || "Untitled session",
      modified: row.last_message_at || row.updated_at,
      messageCount: row.message_count,
      live,
      status: live ? row.status : "idle",
      unread: row.unread,
    });
    byProject.set(key, group);
  }

  const dirs: ProjectDirectory[] = [...byProject.values()].map((g) => ({
    projectPath: g.projectPath,
    engineId: g.engineId,
    sessions: g.sessions,
    live: g.sessions.some((s) => s.live),
  }));
  for (const engine of Object.values(useEngineStore.getState().engines)) {
    if (engine.default_project && !byProject.has(groupKey(engine.id, engine.default_project))) {
      dirs.unshift({ projectPath: engine.default_project, engineId: engine.id, sessions: [], live: false });
    }
  }
  useSidebarStore.getState().setDirectories(dirs);

  // Live updates arrive via tab_status from here on; this seeds tabs that were
  // already open (e.g. right after a page load) with their current status.
  const { setStatus } = useTabStatusStore.getState();
  const { refreshLabel } = useTabsStore.getState();
  for (const dir of dirs) {
    for (const s of dir.sessions) {
      if (s.live && s.status) setStatus(tabKey(dir.projectPath, s.sessionId), s.status === "idle" && s.unread ? "unread" : s.status);
      if (s.title) refreshLabel(dir.projectPath, s.sessionId, s.title);
    }
  }
  return dirs;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleRefreshSessions(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshSessions();
  }, 1000);
}

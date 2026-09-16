"use client";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Topbar } from "@/components/app-shell/Topbar";
import { SessionInfoChips } from "@/components/app-shell/SessionInfoChips";
import { TabStrip } from "@/components/app-shell/TabStrip";
import { ChatArea } from "@/components/chat/ChatArea";
import { ConfigSheet } from "@/components/sheets/ConfigSheet";
import { AuthSheet } from "@/components/sheets/AuthSheet";
import { McpSheet } from "@/components/sheets/McpSheet";
import { NewSessionSheet } from "@/components/sheets/NewSessionSheet";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSessionStore } from "@/store/sessionStore";
import { switchProject } from "@/lib/client/switchProject";
import { readUrlParams, setSuppressHistoryPush } from "@/lib/client/urlSync";

export default function Home() {
  useWebSocket();

  // An explicit URL (bookmarked, shared, or arrived at via back/forward) wins over
  // whatever was last used on this device, and initializes the very first attach.
  useEffect(() => {
    const { project, session } = readUrlParams();
    const { currentProject, currentSessionId } = useSessionStore.getState();
    const resolvedProject = project || currentProject;
    if (resolvedProject) {
      switchProject(resolvedProject, { sessionId: session || currentSessionId || undefined });
    } else {
      fetch("/api/sessions")
        .then((r) => r.json())
        .then((data) => switchProject(data.default))
        .catch((e) => console.error("failed to resolve default project:", e));
    }

    const onPopState = () => {
      const params = readUrlParams();
      if (!params.project) return;
      // Don't push a NEW history entry for a switch that's itself the result of
      // navigating history — that would corrupt the back/forward stack.
      setSuppressHistoryPush(true);
      switchProject(params.project, { sessionId: params.session || undefined });
      setSuppressHistoryPush(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <TabStrip />
      <Topbar />
      <SessionInfoChips />
      <ChatArea />
      <ConfigSheet />
      <AuthSheet />
      <McpSheet />
      <NewSessionSheet />
    </AppShell>
  );
}

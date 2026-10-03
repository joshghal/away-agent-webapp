"use client";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Topbar } from "@/components/app-shell/Topbar";
import { SessionInfoChips } from "@/components/app-shell/SessionInfoChips";
import { TabStrip } from "@/components/app-shell/TabStrip";
import { ChatArea } from "@/components/chat/ChatArea";
import { ConfigSheet } from "@/components/sheets/ConfigSheet";
import { DeviceSheet } from "@/components/sheets/DeviceSheet";
import { NewSessionSheet } from "@/components/sheets/NewSessionSheet";
import { LoginGate } from "@/components/auth/LoginGate";
import { useSessionStore } from "@/store/sessionStore";
import { switchProject } from "@/lib/client/switchProject";
import { startHub, resolveDefaultProject } from "@/lib/client/hub";
import { refreshSessions } from "@/lib/client/fetchSessions";
import { readUrlParams, setSuppressHistoryPush } from "@/lib/client/urlSync";

export default function Home() {
  return (
    <LoginGate>
      <App />
    </LoginGate>
  );
}

function App() {
  // An explicit URL (bookmarked, shared, or arrived at via back/forward) wins over
  // whatever was last used on this device, and initializes the very first attach.
  useEffect(() => {
    const { project, session } = readUrlParams();
    const { currentProject, currentSessionId } = useSessionStore.getState();
    const resolvedProject = project || currentProject;
    // Engines and the session list first: routing a session to its device needs both.
    void startHub()
      .then(() => refreshSessions())
      .then(async () => {
        const target = resolvedProject || (await resolveDefaultProject());
        if (target) switchProject(target, { sessionId: (resolvedProject && (session || currentSessionId)) || undefined });
      });

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
      <DeviceSheet />
      <NewSessionSheet />
    </AppShell>
  );
}

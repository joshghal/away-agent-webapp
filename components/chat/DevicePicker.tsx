"use client";
import { Dropdown } from "@/components/settings/Dropdown";
import { LaptopIcon } from "@/components/icons/icons";
import { useEngineStore } from "@/store/engineStore";
import { useSessionStore } from "@/store/sessionStore";
import { useChatStore } from "@/store/chatStore";
import { engineFor } from "@/lib/client/hub";
import { switchProject } from "@/lib/client/switchProject";

// Which device runs this chat. Only shown with 2+ devices online. A session that
// already has history stays on its device (claude --resume needs its transcript),
// so the picker is locked there; for a fresh chat, picking a device starts it there.
export function DevicePicker() {
  const { engines, online, setPreferred } = useEngineStore();
  const { currentProject, currentSessionId, currentEngineId } = useSessionStore();
  const hasHistory = useChatStore((s) => s.entries.length > 0);
  if (online.length < 2) return null;

  const current = currentEngineId ?? engineFor(currentProject, currentSessionId) ?? online[0];
  const name = (id: string) => engines[id]?.device_name || id;
  // Flag a device that can't run chats at all, right where you choose it.
  const label = (id: string) =>
    engines[id]?.claude_auth?.state === "cli_missing" ? `${name(id)} · Claude CLI missing` : name(id);

  if (currentSessionId && hasHistory) {
    return (
      <span
        title={`Runs on ${name(current)}. A session stays on the device that started it.`}
        className="flex-none flex items-center gap-1.5 max-w-[140px] rounded-full bg-panel py-1.5 px-3 text-xs text-text-2 border border-panel-border-soft"
      >
        <LaptopIcon className="w-3.5 h-3.5 flex-none" />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name(current)}</span>
      </span>
    );
  }

  return (
    <Dropdown
      value={current}
      options={online.map((id) => ({ value: id, label: label(id) }))}
      compact
      openUpward
      onChange={(id) => {
        if (id === current) return;
        setPreferred(id);
        const project = engines[id]?.default_project || currentProject;
        if (project) switchProject(project, { forceNew: true, engineId: id });
      }}
    />
  );
}

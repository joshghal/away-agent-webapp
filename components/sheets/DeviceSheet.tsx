"use client";
import { Sheet, FieldLabel } from "./Sheet";
import { AuthPanel } from "./AuthSheet";
import { McpPanel } from "./McpSheet";
import { useUiStore } from "@/store/uiStore";
import { useAuthStore } from "@/store/authStore";
import { useEngineStore } from "@/store/engineStore";

// Everything that belongs to one device: its Claude login and its MCP servers.
// Each device has its own; changes run on that device through its engine.
export function DeviceSheet() {
  const { activeSheet, closeSheet } = useUiStore();
  const { engineId, deviceName } = useAuthStore();
  const engine = useEngineStore((s) => (engineId ? s.engines[engineId] : undefined));
  const online = useEngineStore((s) => !!engineId && s.online.includes(engineId));

  return (
    <Sheet open={activeSheet === "device"} onClose={closeSheet} title={deviceName ?? "Device"}>
      <div className="text-[11.5px] text-text-3 mb-4">
        {engine?.model ?? "Device"}
        {engine?.fingerprint ? ` · ${engine.fingerprint}` : ""} ·{" "}
        <span className={online ? "text-success" : "text-warn"}>{online ? "online" : "offline — changes need it online"}</span>
      </div>
      <FieldLabel>Claude login</FieldLabel>
      <div className="mb-5">
        <AuthPanel />
      </div>
      <FieldLabel>MCP servers</FieldLabel>
      <McpPanel />
    </Sheet>
  );
}

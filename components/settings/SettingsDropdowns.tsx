"use client";
import { Dropdown } from "./Dropdown";
import { useSettingsStore } from "@/store/settingsStore";
import { useTargetEngine } from "@/lib/client/targetEngine";
import { applySettingsLive } from "@/lib/client/applySettingsLive";
import { MODEL_OPTIONS, EFFORT_OPTIONS, PERMISSION_MODE_OPTIONS, MCP_PRESET_OPTIONS } from "@/lib/shared/constants";

// The three inline pills that live directly in the input bar — visible and
// immediately effective, not hidden in a settings sheet, per an explicit request
// that changing them should be easy to find and should actually take effect.
export function InlineSettingsDropdowns() {
  const { model, effort, permissionMode, setModel, setEffort, setPermissionMode } = useSettingsStore();
  // The device this session runs on (or a fresh chat would start on) decides
  // whether bypass is allowed; its engine refuses it otherwise.
  const bypassOff = useTargetEngine()?.allow_bypass === false;
  const permissionOptions = bypassOff
    ? PERMISSION_MODE_OPTIONS.map((o) =>
        o.value === "bypassPermissions" ? { ...o, label: "Bypass (off on this device)" } : o
      )
    : PERMISSION_MODE_OPTIONS;
  return (
    <>
      <Dropdown
        value={model}
        options={MODEL_OPTIONS}
        compact
        openUpward
        onChange={(v) => {
          setModel(v);
          applySettingsLive();
        }}
      />
      <Dropdown
        value={effort}
        options={EFFORT_OPTIONS}
        compact
        openUpward
        onChange={(v) => {
          setEffort(v);
          applySettingsLive();
        }}
      />
      <Dropdown
        value={permissionMode}
        options={permissionOptions}
        compact
        openUpward
        onChange={(v) => {
          setPermissionMode(v);
          applySettingsLive();
        }}
      />
    </>
  );
}

// MCP preset lives in the Configuration sheet — it's a startup-time choice you
// change far less often than model/effort/permission.
export function McpPresetDropdown() {
  const { mcpPreset, setMcpPreset } = useSettingsStore();
  return (
    <Dropdown
      value={mcpPreset}
      options={MCP_PRESET_OPTIONS}
      onChange={(v) => {
        setMcpPreset(v);
        applySettingsLive();
      }}
    />
  );
}

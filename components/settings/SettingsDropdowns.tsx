"use client";
import { useRef, useState } from "react";
import { Dropdown } from "./Dropdown";
import { useSettingsStore } from "@/store/settingsStore";
import { useTargetEngine } from "@/lib/client/targetEngine";
import { applySettingsLive } from "@/lib/client/applySettingsLive";
import { MODEL_OPTIONS, EFFORT_OPTIONS, PERMISSION_MODE_OPTIONS, MCP_PRESET_OPTIONS } from "@/lib/shared/constants";

const KNOWN_MODELS = new Set(MODEL_OPTIONS.map((o) => o.value));

// The three inline pills that live directly in the input bar — visible and
// immediately effective, not hidden in a settings sheet, per an explicit request
// that changing them should be easy to find and should actually take effect.
export function InlineSettingsDropdowns() {
  const { model, effort, permissionMode, setModel, setEffort, setPermissionMode } = useSettingsStore();
  const isCustom = !KNOWN_MODELS.has(model) || model === "custom";
  const [customDraft, setCustomDraft] = useState(isCustom ? model : "");
  const inputRef = useRef<HTMLInputElement>(null);

  function commitCustom(val: string) {
    const trimmed = val.trim();
    if (trimmed && trimmed !== "custom") {
      setModel(trimmed);
      applySettingsLive();
    } else if (!trimmed) {
      // revert to sonnet if cleared
      setModel("sonnet");
      applySettingsLive();
    }
  }

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
      {isCustom ? (
        <input
          ref={inputRef}
          autoFocus
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onBlur={() => commitCustom(customDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitCustom(customDraft); inputRef.current?.blur(); }
            if (e.key === "Escape") { setCustomDraft(""); setModel("sonnet"); applySettingsLive(); }
          }}
          placeholder="model id…"
          className="flex-none w-[120px] rounded-full bg-panel py-1.5 px-3 text-xs text-text-1 border border-accent-soft-border outline-none"
        />
      ) : (
        <Dropdown
          value={model}
          options={MODEL_OPTIONS}
          compact
          openUpward
          onChange={(v) => {
            if (v === "custom") {
              setCustomDraft("");
              setModel("custom");
              setTimeout(() => inputRef.current?.focus(), 0);
            } else {
              setModel(v);
              applySettingsLive();
            }
          }}
        />
      )}
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

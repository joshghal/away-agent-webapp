// Single source of truth for validation server-side AND for populating the
// Model/Effort/Permission/MCP dropdowns client-side later.

export const VALID_PERMISSION_MODES = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
]);

export const PERMISSION_MODE_OPTIONS = [
  { value: "", label: "Permission" },
  { value: "default", label: "Default (ask)" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan only" },
  { value: "auto", label: "Auto" },
  { value: "dontAsk", label: "Don't ask" },
  { value: "bypassPermissions", label: "Bypass permissions" },
];

export const EFFORT_OPTIONS = [
  { value: "", label: "Effort" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

// Alias values (sonnet/opus/haiku/fable) always resolve to the latest release
// of that family — no hardcoded version numbers to update. "custom" is a sentinel
// that switches the dropdown to a free-text input so you can pin any model ID.
export const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet (latest)" },
  { value: "opus", label: "Opus (latest)" },
  { value: "haiku", label: "Haiku (latest)" },
  { value: "fable", label: "Fable (latest)" },
  { value: "custom", label: "Custom…" },
];

// Loading the full global MCP set (blender, figma-bridge, playwright, mcp-atlassian,
// holoscrape) on every session start is the confirmed root cause of repeated
// multi-minute hangs — mcp-atlassian's `uvx --from git+ssh://...` startup contends
// for uv's install lock across concurrent sessions. "none" is the default (verified:
// 2.18s vs multi-minute). "playwright" is a fast middle ground for screenshots
// specifically — verified 4s, since it's npm-based, not the slow git+uvx path.
// "full" pulls in everything, mcp-atlassian's slowness included (no --mcp-config
// override at all — see MCP_PRESETS below, "full" is deliberately absent as a key).
export const MCP_PRESETS: Record<string, string> = {
  none: '{"mcpServers":{}}',
  playwright: '{"mcpServers":{"playwright":{"command":"npx","args":["-y","@playwright/mcp@latest"]}}}',
};

export const MCP_PRESET_OPTIONS = [
  { value: "none", label: "None (fastest start)" },
  { value: "playwright", label: "Playwright (screenshots)" },
  { value: "full", label: "Full set (slow start)" },
];

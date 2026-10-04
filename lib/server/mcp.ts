import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HOME } from "./env";
import { state } from "./singleton";
import type { McpListResponse, McpServerStatus } from "../shared/ws-protocol";

const execFileAsync = promisify(execFile);

// `claude mcp list` health-checks every configured server and takes ~14s —
// expensive enough that it must never sit on the page-load critical path. Cached
// with a TTL and pre-warmed at server startup so a normal page open/panel tap hits
// the cache, not a fresh scan.
const MCP_CACHE_TTL_MS = 120_000;

// A server's name can itself contain colons (e.g. "plugin:slack:slack"), same as
// the "name: detail" separator — ambiguous from string shape alone. Resolve it by
// preferring the rightmost ": " that's immediately followed by a URL scheme.
function splitMcpNameAndDetail(head: string): { name: string; detail: string } {
  const positions: number[] = [];
  let idx = -1;
  while ((idx = head.indexOf(": ", idx + 1)) !== -1) positions.push(idx);
  for (let i = positions.length - 1; i >= 0; i--) {
    const detail = head.slice(positions[i] + 2);
    if (/^https?:\/\//.test(detail)) return { name: head.slice(0, positions[i]), detail };
  }
  const first = positions[0];
  if (first === undefined) return { name: head, detail: "" };
  return { name: head.slice(0, first), detail: head.slice(first + 2) };
}

export async function listMcpServers(): Promise<McpListResponse> {
  let raw: string;
  let failure: string | null = null;
  try {
    const { stdout } = await execFileAsync("claude", ["mcp", "list"], {
      cwd: HOME,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    raw = stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string; killed?: boolean };
    // A non-zero exit can still print a usable list (some servers failing), so
    // keep its stdout; only report the failure if no list came back at all.
    raw = (err.stdout || "").toString();
    failure =
      err.code === "ENOENT"
        ? "Claude Code CLI isn't installed on this device."
        : err.killed
          ? "`claude mcp list` timed out on this device."
          : (err.stderr || "").toString().trim().split("\n").pop() || err.message;
  }
  const servers: McpListResponse["servers"] = [];
  const warnings: string[] = [];
  let inDiagnostics = false;
  for (const line of raw.split("\n")) {
    if (/^MCP Config Diagnostics/.test(line)) {
      inDiagnostics = true;
      continue;
    }
    if (inDiagnostics) {
      const trimmed = line.trim();
      if (trimmed && !/^For help configuring/.test(trimmed)) warnings.push(trimmed);
      continue;
    }
    // Split off the trailing " - <icon> <status>" first, then split the remaining
    // "name: detail" part separately — some server names contain colons themselves.
    const m = line.match(/^(.+?)\s-\s(✓|✗|!)\s*(.+)$/);
    if (!m) continue;
    const [, head, icon, statusText] = m;
    const { name, detail } = splitMcpNameAndDetail(head.trim());
    const isUrl = /^https?:\/\//.test(detail.trim());
    const status: McpServerStatus = icon === "✓" ? "connected" : icon === "✗" ? "failed" : "needs_auth";
    servers.push({
      name: name.trim(),
      // Never surface raw stdio command lines — they can (and in this setup, do)
      // embed plaintext secrets as command-line arguments.
      detail: isUrl ? detail.trim() : null,
      status,
      statusText: statusText.trim(),
    });
  }
  return { servers, warnings, error: servers.length === 0 ? failure : null };
}

export async function getMcpServersCached(force = false): Promise<McpListResponse> {
  if (!force && state.mcpCache.data && Date.now() - state.mcpCache.at < MCP_CACHE_TTL_MS) {
    return state.mcpCache.data;
  }
  const data = await listMcpServers();
  state.mcpCache = { data, at: Date.now() };
  return data;
}

export async function addMcpServer({ name, url }: { name: string; url: string }): Promise<void> {
  if (!name || !url) throw new Error("name and url are required");
  // `claude mcp add` defaults to "local" scope (tied to whatever directory the
  // command happens to run from) — wrong default for a phone-facing panel with no
  // real notion of "current directory". Always add at "user" (global) scope instead.
  await execFileAsync("claude", ["mcp", "add", "--transport", "http", "--scope", "user", name, url], {
    cwd: HOME,
    timeout: 30000,
  });
}

export async function removeMcpServer(name: string): Promise<void> {
  if (!name) throw new Error("name is required");
  await execFileAsync("claude", ["mcp", "remove", name], { cwd: HOME, timeout: 30000 });
}

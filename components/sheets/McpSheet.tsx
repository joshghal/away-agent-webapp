"use client";
import { useEffect, useState } from "react";
import { useMcpStore } from "@/store/mcpStore";
import { useAuthStore } from "@/store/authStore";
import { useEngineStore } from "@/store/engineStore";
import { timeAgo } from "@/lib/client/timeAgo";

const DOT_COLOR = { connected: "bg-success", needs_auth: "bg-warn", failed: "bg-danger" };

// MCP servers are configured per device (each machine's own `claude mcp` config).
export function McpPanel() {
  const engineId = useAuthStore((s) => s.engineId);
  const engine = useEngineStore((s) => (engineId ? s.engines[engineId] : undefined));
  const deviceOnline = useEngineStore((s) => !!engineId && s.online.includes(engineId));
  const { loading, error, add, remove, refresh, settle } = useMcpStore();
  const servers = engine?.mcp?.servers ?? [];
  const warnings = engine?.mcp?.warnings ?? [];
  // Without the CLI there is nothing to check; an older saved list may predate this.
  const noCli = engine?.claude_auth?.state === "cli_missing";
  const checkError = noCli ? "Claude Code CLI isn't installed on this device." : (engine?.mcp?.error ?? null);
  const checkedAt = engine?.mcp_checked_at ?? null;

  // The device writes a fresh result (new mcp_checked_at) when a change lands.
  useEffect(() => settle(), [engine?.mcp_checked_at, settle]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  async function removeServer(serverName: string) {
    if (!confirm(`Remove MCP server "${serverName}"?`)) return;
    if (engineId) await remove(engineId, serverName);
  }

  async function addServer() {
    if (!name.trim() || !url.trim()) return;
    if (engineId) await add(engineId, name.trim(), url.trim());
    setName("");
    setUrl("");
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-1 text-[10.5px] text-text-3">
        <span>
          {checkedAt ? `Checked ${timeAgo(checkedAt)}` : "Not checked yet"}
          {servers.length > 0 && !noCli ? ` · ${servers.filter((s) => s.status === "connected").length}/${servers.length} connected` : ""}
        </span>
        <button
          onClick={() => engineId && refresh(engineId)}
          disabled={loading || !deviceOnline}
          title={deviceOnline ? "Run `claude mcp list` on the device again (takes ~15s)" : "Device offline"}
          className="flex-none border border-panel-border-soft rounded-md px-2 py-0.5 hover:text-text-1 hover:bg-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      <div className="mb-3">
        {loading && <div className="text-[12.5px] text-text-3 text-center py-3">Checking servers on the device (~15s)…</div>}
        {!loading && (servers.length === 0 || noCli) && (
          <div className={`text-[12.5px] text-center py-5 ${checkError ? "text-warn" : "text-text-3"}`}>
            {checkError
              ? `Couldn't check MCP servers: ${checkError}`
              : !engine?.mcp
              ? deviceOnline
                ? "This device hasn't reported its MCP servers yet. Press Refresh."
                : "This device hasn't reported its MCP servers yet. It will when it's back online."
              : checkError
                ? `Couldn't check MCP servers: ${checkError}`
                : "No MCP servers are configured on this device."}
          </div>
        )}
        {!noCli && servers.map((s) => (
          <div key={s.name} className="flex items-center gap-2.5 py-2.5 border-b border-panel-border-soft last:border-0">
            <span className={`w-[7px] h-[7px] rounded-full flex-none ${DOT_COLOR[s.status]}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-text-1">{s.name}</div>
              <div className="text-[10.5px] text-text-3 overflow-hidden text-ellipsis whitespace-nowrap">
                {s.statusText}
                {s.detail ? ` · ${s.detail}` : ""}
              </div>
            </div>
            <button
              onClick={() => removeServer(s.name)}
              disabled={!deviceOnline}
              className="flex-none border border-panel-border-soft text-danger rounded-lg py-1 px-2.5 text-xs hover:border-danger/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {warnings.length > 0 && <div className="text-[11px] text-warn mb-2.5 whitespace-pre-wrap">{warnings.join("\n")}</div>}
      {error && <div className="text-[11px] text-danger mb-2.5">MCP change failed: {error}</div>}
      <div className="flex gap-1.5 mb-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          className="flex-none w-[35%] min-w-0 bg-black/22 border border-panel-border-soft rounded-lg py-2.5 px-2.5 text-[13px] text-text-1 outline-none focus:border-accent-soft-border"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="flex-1 min-w-0 bg-black/22 border border-panel-border-soft rounded-lg py-2.5 px-2.5 text-[13px] text-text-1 outline-none focus:border-accent-soft-border"
        />
        <button
          onClick={addServer}
          disabled={loading || !deviceOnline}
          className="flex-none bg-success text-[#06281d] rounded-lg py-2.5 px-4 text-[13px] font-semibold disabled:opacity-60"
        >
          Add
        </button>
      </div>
      <div className="text-[10.5px] text-text-3 leading-relaxed">
        Only HTTP servers can be added here. Local (stdio) servers, and finishing a &quot;Needs authentication&quot;
        sign-in, are done on the device itself: <code>claude mcp add</code> or <code>/mcp</code> in Claude Code.
      </div>
    </>
  );
}

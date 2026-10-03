"use client";
import { useState } from "react";
import { Sheet } from "./Sheet";
import { useUiStore } from "@/store/uiStore";
import { useMcpStore } from "@/store/mcpStore";

const DOT_COLOR = { connected: "bg-success", needs_auth: "bg-warn", failed: "bg-danger" };

export function McpSheet() {
  const { activeSheet, closeSheet } = useUiStore();
  const { servers, warnings, loading, error, add, remove } = useMcpStore();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  async function removeServer(serverName: string) {
    if (!confirm(`Remove MCP server "${serverName}"?`)) return;
    await remove(serverName);
  }

  async function addServer() {
    if (!name.trim() || !url.trim()) return;
    await add(name.trim(), url.trim());
    setName("");
    setUrl("");
  }

  return (
    <Sheet open={activeSheet === "mcp"} onClose={closeSheet} title="MCP servers">
      <div className="mb-3">
        {loading && <div className="text-[12.5px] text-text-3 text-center py-3">Checking servers on the device…</div>}
        {!loading && servers.length === 0 && (
          <div className="text-[12.5px] text-text-3 text-center py-5">No MCP status reported by a device yet.</div>
        )}
        {servers.map((s) => (
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
              className="flex-none border border-panel-border-soft text-danger rounded-lg py-1 px-2.5 text-xs hover:border-danger/40 transition-colors"
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
          disabled={loading}
          className="flex-none bg-success text-[#06281d] rounded-lg py-2.5 px-4 text-[13px] font-semibold disabled:opacity-60"
        >
          Add
        </button>
      </div>
      <div className="text-[10.5px] text-text-3 leading-relaxed">
        HTTP servers only here. Local/stdio servers and completing &quot;needs auth&quot; logins still require the ttyd/SSH
        terminal.
      </div>
    </Sheet>
  );
}

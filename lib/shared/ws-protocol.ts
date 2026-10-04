// Shared WS protocol contract — imported by both server.ts/lib/server/* and the
// client. Keeping this in one module lets TypeScript enforce exhaustive handling
// on both ends of the socket, which is the direct fix for "state is not handled
// well": a new event type added on one side without a matching case on the other
// now fails to compile instead of silently falling through.

// `data` (base64) only exists on the engine before upload; everything the browser
// receives carries `path`, an object in the private transcript-images bucket.
export type ImagePart = { mediaType: string; data?: string; path?: string };

export type TurnStatus = "idle" | "processing" | "permission";

export type AuthStatus =
  | {
      state: "ready";
      email?: string;
      subscriptionType?: string;
      authMethod?: string;
      apiProvider?: string;
      orgName?: string;
      orgId?: string;
    }
  // cli_missing: no `claude` on this device's PATH (e.g. only VS Code's bundled copy) —
  // the engine can't run any session until Claude Code is installed.
  | { state: "needs_reauth" | "not_configured" | "cli_missing" };

export type HistoryItem =
  | { type: "user_message"; text: string | null }
  | { type: "assistant_text"; text: string; standalone: true }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; images: ImagePart[]; is_error: boolean };

// ---- Client -> Server ----
export type ClientMessage =
  | {
      type: "init";
      project?: string;
      sessionId?: string;
      forceNew?: boolean;
      model?: string;
      effort?: string;
      permissionMode?: string;
      mcpPreset?: string;
    }
  | { type: "user_message"; text: string }
  | { type: "approval_response"; request_id: string; allow: boolean; input?: unknown; reason?: string }
  | { type: "update_settings"; model?: string; effort?: string; permissionMode?: string; mcpPreset?: string }
  | { type: "kill_session"; project: string }
  | { type: "login_start" }
  | { type: "login_code"; code: string }
  // Engine-level requests (the device's filesystem / CLI config, not a session).
  | { type: "browse_dirs"; request_id: string; path?: string }
  | { type: "mcp_refresh" }
  | { type: "mcp_add"; name: string; url: string }
  | { type: "mcp_remove"; name: string }
  | { type: "auth_refresh" };

// ---- Server -> Client ----
export type ServerMessage =
  | { type: "session_init"; session_id: string | null; cwd: string; project: string; reattached?: boolean }
  // The session's transcript is now mirrored into session_events — load it from there.
  | { type: "history_ready"; session_id: string }
  | { type: "error"; message: string }
  | { type: "message_delivered" }
  | { type: "settings_applied" }
  | { type: "assistant_text_delta"; text: string }
  | { type: "thinking_start" }
  | { type: "thinking_delta"; text: string }
  | { type: "content_block_stop" }
  | { type: "working"; status: string }
  | { type: "stall_warning"; elapsedMs: number; message: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; images: ImagePart[]; is_error: boolean }
  | { type: "approval_request"; request_id: string; tool_name: string; input: unknown; description?: string }
  | { type: "turn_complete"; result?: string; is_error?: boolean; cost_usd?: number }
  | { type: "process_exit"; code: number | null }
  | { type: "auth_required"; authStatus: AuthStatus }
  | { type: "login_url"; url: string }
  | { type: "login_result"; success: boolean; authStatus: AuthStatus; message?: string | null }
  // Sent to every connected socket, not just subscribers of `project` — a tab for
  // a project this connection isn't currently attached to still needs to know
  // whether that session is idle/processing/waiting on a permission decision.
  | { type: "tab_status"; project: string; sessionId: string | null; status: TurnStatus; unread: boolean }
  | { type: "browse_result"; request_id: string; path: string; parent: string | null; dirs: { name: string; path: string }[] }
  | { type: "browse_error"; request_id: string; message: string }
  | { type: "mcp_error"; message: string }
  // Refused to resume: another app (VS Code, a terminal) is writing this session now.
  | { type: "session_busy"; session_id: string; seconds_ago: number };

// What engines broadcast on the "hub" Realtime channel. `to` is the browser
// tab's client id, or null for messages every tab should see (tab_status).
export type HubEnvelope = { engine_id: string; to: string | null; msg: ServerMessage };

export type EngineRow = {
  id: string;
  hostname: string | null;
  home_dir: string | null;
  default_project: string | null;
  claude_auth: AuthStatus | null;
  mcp: McpListResponse | null;
  mcp_checked_at: string | null;
  allow_bypass?: boolean;
  last_seen_at: string;
  fingerprint: string | null;
  device_name: string | null;
  model: string | null;
  platform: string | null;
};

export type SessionRow = {
  id: string;
  project_path: string;
  title: string | null;
  engine_id: string | null;
  status: TurnStatus;
  unread: boolean;
  live: boolean;
  message_count: number;
  last_message_at: string | null;
  updated_at: string;
};

export type SessionSummary = {
  sessionId: string;
  engineId?: string | null;
  title: string;
  modified: string;
  messageCount: number;
  live?: boolean;
  status?: TurnStatus;
  unread?: boolean;
};

export type ProjectDirectory = {
  projectPath: string;
  // The device this folder lives on — the same path on two machines is two folders.
  engineId: string | null;
  sessions: SessionSummary[];
  live?: boolean;
};


export type McpServerStatus = "connected" | "needs_auth" | "failed";
export type McpServerEntry = { name: string; detail: string | null; status: McpServerStatus; statusText: string };
// error: the check itself failed (e.g. no `claude` CLI), so `servers` says nothing.
export type McpListResponse = { servers: McpServerEntry[]; warnings: string[]; error?: string | null };

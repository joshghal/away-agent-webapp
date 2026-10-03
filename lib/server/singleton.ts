import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpListResponse, ServerMessage } from "../shared/ws-protocol";

// Anchored on globalThis so every importer shares one instance even if a module
// ends up loaded twice (tsx watch reloads, mixed import paths).

export type PendingApproval = {
  type: "approval_request";
  request_id: string;
  tool_name: string;
  input: unknown;
  description?: string;
};

export type LiveSessionEntry = {
  child: ChildProcessWithoutNullStreams;
  sessionId: string | null;
  subscribers: Set<(obj: ServerMessage) => void>;
  pendingApprovals: Map<string, PendingApproval>;
  turnStartedAt: number | null;
  lastActivityAt: number;
  stallLevelNotified: number;
  // True once a turn finishes with nobody currently subscribed to see it live —
  // tracked here (not just derived client-side from "was this the active tab")
  // specifically so it survives a page refresh: the client's own notion of
  // "active tab at completion time" is gone the moment the page reloads, but
  // this flag lives on the server for as long as the process does.
  unread: boolean;
};

type GlobalState = {
  liveSessions: Map<string, LiveSessionEntry>;
  // sessionId -> when this process last ran it. Distinguishes "recently written by
  // us" from "recently written by another app" (VS Code, a terminal).
  recentlyOwned: Map<string, number>;
  projectLocks: Map<string, Promise<unknown>>;
  mcpCache: { data: McpListResponse | null; at: number };
  // Sinks for tab_status, independent of which project (if any) a viewer is
  // attached to — a tab for a project nobody is viewing still needs its status.
  allConnections: Set<(obj: ServerMessage) => void>;
};

const g = globalThis as unknown as { __agentWebapp?: GlobalState };

g.__agentWebapp ??= {
  liveSessions: new Map(),
  recentlyOwned: new Map(),
  projectLocks: new Map(),
  mcpCache: { data: null, at: 0 },
  allConnections: new Set(),
};

export const state = g.__agentWebapp;

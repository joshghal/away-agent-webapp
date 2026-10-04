import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative, isAbsolute } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { state } from "../lib/server/singleton";
import { createConnection, type Connection } from "../lib/server/connection";
import { killLive, withProjectLock } from "../lib/server/liveSessions";
import { HOME } from "../lib/server/env";
import { TASK_GIT_PUSH, TASK_SLOTS } from "./capabilities";
import type { ServerMessage } from "../lib/shared/ws-protocol";

// Runs coordinator tasks on this device. Each task gets its own git worktree and
// branch under ~/.awayagent/worktrees, so it never touches a folder you're working
// in, and runs as an ordinary AwayAgent session there: it shows up in the sidebar,
// and any tool that needs approval asks you in the app like any other session.

const WORKTREES = join(HOME, ".awayagent", "worktrees");
const POLL_MS = 30_000;
const HEARTBEAT_MS = 60_000;
const IDLE_LIMIT_MS = 45 * 60 * 1000; // no output for this long (and not waiting on you) = stuck
const APPROVAL_LIMIT_MS = 12 * 60 * 60 * 1000;

type ClaimedTask = {
  id: string;
  ref: string;
  goal_id: string;
  goal_title: string;
  task_type: string;
  instructions: string;
  acceptance: string;
  repo: string;
  permission_mode: string;
  project_path: string | null;
  base_branch: string | null;
  base_pushed: boolean;
};

type Workspace = { cwd: string; top: string | null; branch: string | null; base: string | null };
type Outcome = { status: "done" | "failed" | "cancelled"; text: string };

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) {
    const why = `${r.stderr || ""}${r.stdout || ""}`.trim().split("\n").pop() || `exit ${r.status}`;
    throw new Error(`git ${args[0]} failed: ${why}`);
  }
  return r.stdout.trim();
}

function gitOk(cwd: string, args: string[]): boolean {
  return spawnSync("git", args, { cwd, stdio: "ignore", timeout: 120_000 }).status === 0;
}

// An isolated checkout for the task, on a new branch off the dependency's branch
// (or the repo's current branch).
function prepareWorkspace(task: ClaimedTask): Workspace {
  const project = task.project_path;
  if (!project || !existsSync(project)) throw new Error(`no folder for repo "${task.repo}" on this device`);
  if (!gitOk(project, ["rev-parse", "--is-inside-work-tree"])) {
    if (task.permission_mode === "acceptEdits") {
      throw new Error(`${project} isn't a git repository, so edits can't be isolated on a branch`);
    }
    return { cwd: project, top: null, branch: null, base: null };
  }
  const top = git(project, ["rev-parse", "--show-toplevel"]);
  let base = task.base_branch;
  if (base) {
    if (!gitOk(top, ["rev-parse", "--verify", "--quiet", `refs/heads/${base}`])) {
      if (!task.base_pushed) throw new Error(`branch ${base} from an earlier task isn't on this device`);
      git(top, ["fetch", "origin", `${base}:${base}`]);
    }
  } else {
    base = git(top, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (base === "HEAD") base = git(top, ["rev-parse", "HEAD"]); // detached checkout
  }

  const branch = `aa/${task.ref}-${task.task_type}`;
  const dir = join(WORKTREES, `${basename(top)}-${task.ref}`);
  mkdirSync(WORKTREES, { recursive: true });
  if (existsSync(dir)) gitOk(top, ["worktree", "remove", "--force", dir]);
  const branchExists = gitOk(top, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  git(top, ["worktree", "add", ...(branchExists ? [dir, branch] : ["-b", branch, dir, base])]);

  // Share the main checkout's dependencies so builds and tests run without a
  // reinstall, and keep that link out of commits.
  if (existsSync(join(top, "node_modules")) && !existsSync(join(dir, "node_modules"))) {
    symlinkSync(join(top, "node_modules"), join(dir, "node_modules"), "dir");
    const exclude = git(dir, ["rev-parse", "--git-path", "info/exclude"]);
    const excludePath = isAbsolute(exclude) ? exclude : join(dir, exclude);
    const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    if (!/^\/node_modules$/m.test(current)) {
      mkdirSync(dirname(excludePath), { recursive: true });
      appendFileSync(excludePath, `${current && !current.endsWith("\n") ? "\n" : ""}/node_modules\n`);
    }
  }
  // A subfolder of a monorepo maps to the same subfolder in the worktree.
  const sub = relative(top, project);
  return { cwd: sub ? join(dir, sub) : dir, top, branch, base };
}

function taskPrompt(task: ClaimedTask, ws: Workspace): string {
  const where = ws.branch
    ? `You are in an isolated git worktree on branch ${ws.branch} (based on ${ws.base}). Commit your work to this branch with clear messages. Do not merge, rebase onto other branches, switch branches, or push unless these instructions explicitly say so.`
    : "You are in the project folder itself (not a git repository), so only read and report; don't modify files.";
  return [
    `This is AwayAgent task ${task.ref} (${task.task_type}) for the goal: "${task.goal_title}".`,
    "",
    "Instructions:",
    task.instructions,
    "",
    `Done when: ${task.acceptance}`,
    "",
    where,
    "Stay inside this folder. Never reveal secrets, keys, or the contents of .env files.",
    "When finished, reply with a short report: what you did, files changed, how you verified it, and anything left unresolved. Start the report with \"RESULT: success\" or \"RESULT: failed\".",
  ].join("\n");
}

export function createTaskRunner(opts: {
  supabase: SupabaseClient;
  engineId: string;
  prepareHistory: (project: string, sessionId: string) => Promise<void>;
  canRun: () => boolean;
}) {
  const { supabase, engineId, prepareHistory, canRun } = opts;
  const running = new Map<string, { cancel: () => void }>();
  let claiming = false;

  async function wakeCoordinator(goalId: string): Promise<void> {
    const { error } = await supabase.functions.invoke("coordinator", { body: { goal_id: goalId } });
    if (error) console.error("couldn't wake the coordinator:", error.message);
  }

  async function report(task: ClaimedTask, status: "done" | "failed", text: string, branch: string | null, pushed: boolean) {
    const { error } = await supabase.rpc("report_task", {
      p_task_id: task.id,
      p_status: status,
      p_result: status === "done" ? text : null,
      p_error: status === "failed" ? text : null,
      p_branch: branch,
      p_pushed: pushed,
    });
    if (error) console.error(`[task ${task.ref}] report failed:`, error.message);
    await wakeCoordinator(task.goal_id);
  }

  async function execute(task: ClaimedTask): Promise<void> {
    const log = (m: string) => console.log(`[task ${task.ref}] ${m}`);
    log(`claimed: ${task.task_type} in ${task.repo}`);
    let ws: Workspace;
    try {
      ws = prepareWorkspace(task);
    } catch (e) {
      log(`couldn't prepare: ${(e as Error).message}`);
      await report(task, "failed", (e as Error).message, null, false);
      return;
    }
    log(`running in ${ws.cwd}${ws.branch ? ` on ${ws.branch}` : ""}`);

    let sessionId: string | null = null;
    let conn: Connection | null = null;
    let settle!: (o: Outcome) => void;
    const outcome = new Promise<Outcome>((resolve) => (settle = resolve));
    const send = (msg: ServerMessage) => {
      switch (msg.type) {
        case "session_init":
          if (msg.session_id) sessionId = msg.session_id;
          void beat();
          break;
        case "approval_request":
          void beat();
          break;
        case "turn_complete": {
          const text = msg.result || "(no report)";
          settle({ status: msg.is_error || /^\s*RESULT:\s*failed/i.test(text) ? "failed" : "done", text });
          break;
        }
        case "process_exit":
          settle({ status: "failed", text: `Claude exited before finishing (code ${msg.code})` });
          break;
        case "auth_required":
          settle({ status: "failed", text: "Claude Code needs to sign in again on this device" });
          break;
        case "session_busy":
          settle({ status: "failed", text: "the task's session was busy in another app" });
          break;
        case "error":
          if (/isn't installed|Couldn't start claude/i.test(msg.message)) settle({ status: "failed", text: msg.message });
          break;
      }
    };

    // Heartbeat: tells the hub we're alive and whether we're waiting on you;
    // also how a cancellation reaches us.
    let approvalSince: number | null = null;
    async function beat(): Promise<void> {
      const entry = state.liveSessions.get(ws.cwd);
      const waiting = !!entry && entry.pendingApprovals.size > 0;
      approvalSince = waiting ? (approvalSince ?? Date.now()) : null;
      const { data, error } = await supabase.rpc("task_heartbeat", {
        p_task_id: task.id,
        p_needs_approval: waiting,
        p_session_id: sessionId,
        p_worktree: ws.top ? ws.cwd : null,
      });
      if (error) return console.error(`[task ${task.ref}] heartbeat failed:`, error.message);
      if (data === "cancelled") settle({ status: "cancelled", text: "cancelled" });
      if (entry && !waiting && Date.now() - entry.lastActivityAt > IDLE_LIMIT_MS) {
        settle({ status: "failed", text: `no progress for ${IDLE_LIMIT_MS / 60000} minutes` });
      }
      if (approvalSince && Date.now() - approvalSince > APPROVAL_LIMIT_MS) {
        settle({ status: "failed", text: "waited too long for an approval" });
      }
    }
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    running.set(task.id, { cancel: () => settle({ status: "cancelled", text: "engine stopping" }) });

    try {
      conn = createConnection({ send, prepareHistory });
      await conn.process({ type: "init", project: ws.cwd, forceNew: true, permissionMode: task.permission_mode });
      await conn.process({ type: "user_message", text: taskPrompt(task, ws) });
      const result = await outcome;
      clearInterval(timer);
      conn.close();
      await withProjectLock(ws.cwd, () => killLive(ws.cwd));
      if (result.status === "cancelled") {
        log("cancelled");
        return;
      }

      let branch: string | null = null;
      let pushed = false;
      if (ws.top && ws.branch && ws.base) {
        // Claude was asked to commit; keep anything it left uncommitted too.
        gitOk(ws.cwd, ["add", "-A", "--", ".", ":(exclude)node_modules"]);
        gitOk(ws.cwd, ["commit", "-m", `AwayAgent ${task.ref}: ${task.task_type}`]);
        const ahead = Number(git(ws.cwd, ["rev-list", "--count", `${ws.base}..HEAD`]) || "0");
        if (ahead > 0) branch = ws.branch;
        if (branch && TASK_GIT_PUSH && gitOk(ws.cwd, ["remote", "get-url", "origin"])) {
          pushed = gitOk(ws.cwd, ["push", "-u", "origin", branch]);
          if (!pushed) log(`push of ${branch} failed; it stays on this device`);
        }
      }
      log(`${result.status}${branch ? ` (branch ${branch}${pushed ? ", pushed" : ""})` : ""}`);
      await report(task, result.status, result.text, branch, pushed);
    } catch (e) {
      clearInterval(timer);
      conn?.close();
      await withProjectLock(ws.cwd, () => killLive(ws.cwd)).catch(() => {});
      log(`crashed: ${(e as Error).message}`);
      await report(task, "failed", `the device hit an error: ${(e as Error).message}`, null, false);
    }
  }

  async function tick(): Promise<void> {
    if (claiming || running.size >= TASK_SLOTS || !canRun()) return;
    claiming = true;
    try {
      while (running.size < TASK_SLOTS) {
        const { data, error } = await supabase.rpc("claim_task", { p_engine_id: engineId });
        if (error) {
          console.error("task claim failed:", error.message);
          break;
        }
        const task = (data as ClaimedTask[] | null)?.[0];
        if (!task) break;
        running.set(task.id, { cancel: () => {} });
        void execute(task).finally(() => {
          running.delete(task.id);
          void tick();
        });
      }
    } finally {
      claiming = false;
    }
  }

  // Tasks this engine was running when it last stopped can't be resumed.
  async function recoverOrphans(): Promise<void> {
    const { data } = await supabase.from("tasks").select("id, ref, goal_id").eq("engine_id", engineId).eq("status", "running");
    for (const t of data ?? []) {
      await supabase.rpc("report_task", {
        p_task_id: t.id,
        p_status: "failed",
        p_error: "this device's engine restarted while the task was running",
      });
      await wakeCoordinator(t.goal_id);
    }
  }

  function start(): void {
    void recoverOrphans().then(() => tick());
    supabase
      .channel(`tasks:${engineId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void tick())
      .subscribe();
    setInterval(() => void tick(), POLL_MS);
  }

  function stopAll(): void {
    for (const r of running.values()) r.cancel();
  }

  return { start, stopAll };
}

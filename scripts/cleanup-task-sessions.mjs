#!/usr/bin/env node
// Cleanup coordinator task artifacts: git worktrees, aa/* branches,
// local Claude transcripts, and Supabase session rows.
// Run from the agent-webapp-next root after tasks complete.
//
// Usage:
//   node scripts/cleanup-task-sessions.mjs          # dry-run (shows what would be deleted)
//   node scripts/cleanup-task-sessions.mjs --apply  # actually delete everything

import { execSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY = !process.argv.includes("--apply");
if (DRY) console.log("DRY RUN — pass --apply to actually delete\n");

const HOME = homedir();
const WORKTREES_DIR = join(HOME, ".awayagent", "worktrees");
const TRANSCRIPTS_DIR = join(HOME, ".claude", "projects");
const REPO_DIR = process.cwd();

// ── Supabase keys ────────────────────────────────────────────────────────────
// Load via Supabase CLI so the service role key is never written to disk.
function loadServiceRole() {
  const raw = execSync(
    "supabase projects api-keys --project-ref mackvljdwhhpeibbvmfe -o json 2>/dev/null",
    { encoding: "utf8" }
  );
  return JSON.parse(raw).find((k) => k.name === "service_role")?.api_key;
}

async function rest(serviceRole, method, path, body) {
  const base = "https://mackvljdwhhpeibbvmfe.supabase.co/rest/v1";
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// ── Git helpers ──────────────────────────────────────────────────────────────
function git(args, cwd = REPO_DIR) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function taskWorktrees() {
  if (!existsSync(WORKTREES_DIR)) return [];
  return readdirSync(WORKTREES_DIR)
    .filter((d) => /^[^-]+-t\d+$/.test(d)) // e.g. agent-webapp-next-t11
    .map((d) => join(WORKTREES_DIR, d));
}

function taskBranches() {
  const r = git(["branch", "--list", "aa/*"]);
  return r.stdout.trim().split("\n").map((b) => b.replace(/^\*?\s+/, "")).filter(Boolean);
}

function taskTranscripts() {
  if (!existsSync(TRANSCRIPTS_DIR)) return [];
  return readdirSync(TRANSCRIPTS_DIR)
    .filter((d) => d.includes("awayagent-worktrees"))
    .map((d) => join(TRANSCRIPTS_DIR, d));
}

// ── Main ─────────────────────────────────────────────────────────────────────
const worktrees = taskWorktrees();
const branches = taskBranches();
const transcripts = taskTranscripts();

console.log(`Worktrees  (${worktrees.length}): ${worktrees.map((w) => w.split("/").pop()).join(", ") || "none"}`);
console.log(`Branches   (${branches.length}): ${branches.join(", ") || "none"}`);
console.log(`Transcripts(${transcripts.length}): ${transcripts.map((t) => t.split("/").pop()).join(", ") || "none"}`);

let serviceRole;
try { serviceRole = loadServiceRole(); } catch { console.warn("⚠ Could not load Supabase key — skipping DB cleanup"); }

let dbSessions = [];
if (serviceRole) {
  const { data } = await rest(serviceRole, "GET", "/sessions?project_path=like.*worktrees*&select=id,project_path");
  dbSessions = data ?? [];
  console.log(`DB sessions(${dbSessions.length}): ${dbSessions.map((s) => s.project_path.split("/").pop()).join(", ") || "none"}`);
}

if (DRY) { console.log("\nPass --apply to delete all of the above."); process.exit(0); }

// 1. Remove git worktrees
for (const dir of worktrees) {
  const r = git(["worktree", "remove", "--force", dir]);
  console.log(r.status === 0 ? `✓ removed worktree ${dir.split("/").pop()}` : `✗ worktree ${dir}: ${r.stderr.trim()}`);
}
git(["worktree", "prune"]);

// 2. Delete aa/* branches
for (const b of branches) {
  const r = git(["branch", "-D", b]);
  console.log(r.status === 0 ? `✓ deleted branch ${b}` : `✗ branch ${b}: ${r.stderr.trim()}`);
}

// 3. Delete local transcripts
for (const t of transcripts) {
  rmSync(t, { recursive: true, force: true });
  console.log(`✓ removed transcript ${t.split("/").pop()}`);
}

// 4. Delete Supabase session rows
if (serviceRole && dbSessions.length) {
  const { status } = await rest(serviceRole, "DELETE", "/sessions?project_path=like.*worktrees*");
  console.log(status === 204 ? `✓ deleted ${dbSessions.length} DB session(s)` : `✗ DB delete returned ${status}`);
}

// 5. Remove empty worktrees dir
if (existsSync(WORKTREES_DIR) && readdirSync(WORKTREES_DIR).length === 0) {
  rmSync(WORKTREES_DIR, { recursive: true });
  console.log("✓ removed empty worktrees dir");
}

console.log("\nDone.");

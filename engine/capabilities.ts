import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "../lib/server/env";

// What this device can do, so the coordinator routes tasks sensibly. Detected
// where it's cheap and reliable; ENGINE_CAPABILITIES in .env.engine adds more
// (e.g. "gpu"). Tags (ENGINE_TAGS, default "personal") mark where work may run:
// only devices tagged "work" ever get tasks from work goals.

function ok(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: "ignore", timeout: 10_000 }).status === 0;
}

function onPath(bin: string): boolean {
  return ok("/bin/sh", ["-c", `command -v ${bin}`]);
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_:.-]{1,40}$/.test(s));
}

export function detectCapabilities(): string[] {
  const caps = new Set<string>();
  if (process.platform === "darwin" && onPath("xcrun") && ok("xcrun", ["simctl", "help"])) caps.add("ios_sim");
  if (onPath("emulator") || existsSync(join(HOME, "Library", "Android", "sdk", "emulator", "emulator"))) caps.add("android_emulator");
  if (existsSync(join(HOME, "Library", "Caches", "ms-playwright")) || existsSync(join(HOME, ".cache", "ms-playwright"))) caps.add("playwright");
  if (onPath("gh")) caps.add("github_cli");
  for (const c of list(process.env.ENGINE_CAPABILITIES)) caps.add(c);
  return [...caps].sort();
}

export function engineTags(): string[] {
  const tags = list(process.env.ENGINE_TAGS);
  return tags.length ? tags : ["personal"];
}

// Coordinator tasks run here unless .env.engine says TASKS_ENABLED=0.
export const TASKS_ENABLED = process.env.TASKS_ENABLED !== "0";
export const TASK_SLOTS = Math.max(1, Math.min(4, Number(process.env.TASK_SLOTS) || 1));
// Push finished task branches to origin so other devices can build on them.
export const TASK_GIT_PUSH = process.env.TASK_GIT_PUSH === "1";

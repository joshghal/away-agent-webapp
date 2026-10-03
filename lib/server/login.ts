import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { HOME } from "./env";
import { getAuthStatus } from "./authStatus";
import type { ServerMessage } from "../shared/ws-protocol";

// A started-but-unfinished login is a live capability on this machine; don't
// leave one waiting around indefinitely.
const LOGIN_TTL_MS = 10 * 60 * 1000;
// One-time codes from claude.ai are a single token. Anything else (whitespace,
// newlines, odd characters) is rejected so it can't feed extra input lines to
// the login process.
const CODE_PATTERN = /^[A-Za-z0-9#._~-]{8,512}$/;

// One login at a time per device, no matter which viewer started it.
let activeLogin: ChildProcessWithoutNullStreams | null = null;

// `/login` as a chat message doesn't work — headless `-p` mode rejects it.
// `claude auth login` is the CLI's own scriptable command for this instead.
export function createLoginSession(send: (obj: ServerMessage) => void) {
  let loginChild: ChildProcessWithoutNullStreams | null = null;

  function start(): void {
    if (activeLogin && activeLogin.exitCode === null) activeLogin.kill();
    const child = spawn("claude", ["auth", "login", "--claudeai"], { cwd: HOME, stdio: ["pipe", "pipe", "pipe"] });
    loginChild = child;
    activeLogin = child;
    console.log("[login] started from the hub (expires in 10 minutes)");

    let expired = false;
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        expired = true;
        child.kill();
      }
    }, LOGIN_TTL_MS);

    let failedToStart = false;
    child.on("error", (err: NodeJS.ErrnoException) => {
      failedToStart = true;
      clearTimeout(timer);
      if (activeLogin === child) activeLogin = null;
      if (loginChild === child) loginChild = null;
      send({
        type: "login_result",
        success: false,
        authStatus: getAuthStatus(),
        message: err.code === "ENOENT" ? "Claude Code isn't installed on this device." : err.message,
      });
    });

    let buf = "";
    let urlSent = false;
    const onOutput = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const urlMatch = buf.match(/https:\/\/\S+/);
      if (urlMatch && !urlSent) {
        urlSent = true;
        send({ type: "login_url", url: urlMatch[0] });
      }
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (activeLogin === child) activeLogin = null;
      if (loginChild === child) loginChild = null;
      if (failedToStart) return; // already reported by the 'error' handler
      const success = code === 0;
      console.log(`[login] ${success ? "completed" : expired ? "expired" : "ended without completing"}`);
      send({
        type: "login_result",
        success,
        authStatus: getAuthStatus(),
        message: success ? null : expired ? "The login link expired after 10 minutes — start again." : buf.slice(-300),
      });
    });
  }

  function submitCode(code: string): void {
    const clean = code.trim();
    if (!CODE_PATTERN.test(clean)) {
      send({ type: "login_result", success: false, authStatus: getAuthStatus(), message: "That doesn't look like a valid login code." });
      return;
    }
    if (loginChild && !loginChild.stdin.destroyed) {
      loginChild.stdin.write(clean + "\n");
    } else {
      send({ type: "login_result", success: false, authStatus: getAuthStatus(), message: "No login in progress on this device — start again." });
    }
  }

  function cleanup(): void {
    if (loginChild && loginChild.exitCode === null) loginChild.kill();
  }

  return { start, submitCode, cleanup };
}

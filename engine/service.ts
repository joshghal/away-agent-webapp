// Runs the engine as a macOS launchd user service: starts at login, restarts if
// it crashes, survives terminals/sessions closing.
// Usage: npm run engine:service -- install | start | stop | status | logs | uninstall
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LABEL = "com.awayagent.engine";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG = join(homedir(), "Library", "Logs", "away-agent-engine.log");
const DOMAIN = `gui/${process.getuid!()}`;

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function launchctl(...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function loaded(): boolean {
  return launchctl("print", `${DOMAIN}/${LABEL}`).ok;
}

// bootout returns before the engine finishes its graceful shutdown; wait so an
// immediate bootstrap/start doesn't see a half-stopped service and do nothing.
function unload(): void {
  if (!loaded()) return;
  launchctl("bootout", `${DOMAIN}/${LABEL}`);
  for (let i = 0; i < 60 && loaded(); i++) execFileSync("sleep", ["0.5"]);
}

function install(): void {
  const repo = process.cwd();
  if (!existsSync(join(repo, ".env.engine"))) throw new Error("No .env.engine here — run `npm run engine:setup` first.");
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  // A login shell gives the service the same PATH as your terminal (node, claude, …).
  const command = `cd ${JSON.stringify(repo)} && exec node --import tsx engine/index.ts`;
  writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>${xml(command)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`
  );
  unload();
  const r = launchctl("bootstrap", DOMAIN, PLIST);
  if (!r.ok) throw new Error(`launchctl bootstrap failed: ${r.out}`);
  console.log(`Installed and started. Starts automatically at login. Logs: ${LOG}`);
}

function start(): void {
  if (!existsSync(PLIST)) throw new Error("Not installed — run `npm run engine:service -- install`.");
  if (!loaded()) {
    const r = launchctl("bootstrap", DOMAIN, PLIST);
    if (!r.ok) throw new Error(`start failed: ${r.out}`);
  } else {
    launchctl("kickstart", `${DOMAIN}/${LABEL}`);
  }
  console.log("Engine started.");
}

function stop(): void {
  // bootout sends SIGTERM: the engine stops its claude processes and leaves the hub cleanly.
  if (!loaded()) return console.log("Engine is not running.");
  unload();
  console.log("Engine stopped (it will start again at next login; `uninstall` to prevent that).");
}

function status(): void {
  if (!existsSync(PLIST)) return console.log("Not installed.");
  const r = launchctl("print", `${DOMAIN}/${LABEL}`);
  if (!r.ok) return console.log("Installed, not running.");
  const state = r.out.match(/state = (\S+)/)?.[1] ?? "unknown";
  const pid = r.out.match(/pid = (\d+)/)?.[1];
  console.log(`Installed, ${state}${pid ? ` (pid ${pid})` : ""}. Logs: ${LOG}`);
}

function uninstall(): void {
  unload();
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log("Engine service removed.");
}

const commands: Record<string, () => void> = {
  install,
  start,
  stop,
  status,
  uninstall,
  logs: () => execFileSync("tail", ["-n", "50", "-f", LOG], { stdio: "inherit" }),
};

if (process.platform !== "darwin") {
  console.error("The service manager is macOS-only; on other systems run `npm run engine` under systemd, pm2, or tmux.");
  process.exit(1);
}
const cmd = commands[process.argv[2] || "status"];
if (!cmd) {
  console.error("usage: npm run engine:service -- install | start | stop | status | logs | uninstall");
  process.exit(1);
}
try {
  cmd();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

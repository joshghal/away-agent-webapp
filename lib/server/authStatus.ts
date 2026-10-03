import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { HOME } from "./env";
import type { AuthStatus } from "../shared/ws-protocol";

// `claude auth status --json` is the CLI's own official, scriptable status check —
// use that as the authoritative "are we good to go" signal rather than reverse-
// engineering Keychain/file storage. Keychain/file presence is used only as a
// secondary check, to tell "never configured" apart from "was configured but no
// longer logs in" when not ready.
const CREDENTIALS_FILE = join(HOME, ".claude", ".credentials.json");

export function hasStoredCredential(): boolean {
  if (existsSync(CREDENTIALS_FILE)) return true;
  if (process.platform !== "darwin") return false;
  try {
    execSync('security find-generic-password -s "Claude Code-credentials"', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function claudeCliInstalled(): boolean {
  try {
    execSync("command -v claude", { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

export function getAuthStatus(): AuthStatus {
  if (!claudeCliInstalled()) return { state: "cli_missing" };
  try {
    const raw = execSync("claude auth status --json", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).toString("utf8");
    const data = JSON.parse(raw);
    if (data.loggedIn) {
      return {
        state: "ready",
        email: data.email,
        subscriptionType: data.subscriptionType,
        authMethod: data.authMethod,
        apiProvider: data.apiProvider,
        orgName: data.orgName,
        orgId: data.orgId,
      };
    }
  } catch {
    // fall through — treated the same as "not logged in" below
  }
  return { state: hasStoredCredential() ? "needs_reauth" : "not_configured" };
}

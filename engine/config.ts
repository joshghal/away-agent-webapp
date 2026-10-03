import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const ENGINE_ENV_FILE = join(process.cwd(), ".env.engine");
export const KEYCHAIN_SERVICE = "away-agent-engine";

config({ path: ENGINE_ENV_FILE, quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} missing from .env.engine — run \`npm run engine:setup\` on this device first.`);
    process.exit(1);
  }
  return value;
}

export const SUPABASE_URL = required("SUPABASE_URL");
export const SUPABASE_PUBLISHABLE_KEY = required("SUPABASE_PUBLISHABLE_KEY");
export const ENGINE_ID = required("ENGINE_ID");
export const ENGINE_EMAIL = required("ENGINE_EMAIL");

// macOS keeps the engine's password in the Keychain; other platforms fall back to
// ENGINE_PASSWORD in .env.engine (written with 0600 permissions by setup).
export function enginePassword(): string {
  if (process.env.ENGINE_PASSWORD) return process.env.ENGINE_PASSWORD;
  if (process.platform === "darwin") {
    try {
      return execFileSync("security", ["find-generic-password", "-a", ENGINE_ID, "-s", KEYCHAIN_SERVICE, "-w"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // fall through
    }
  }
  console.error("No engine password found (Keychain or ENGINE_PASSWORD) — run `npm run engine:setup` again.");
  process.exit(1);
}

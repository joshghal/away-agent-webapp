// Registers THIS device as an AwayAgent engine: creates (or rotates) its own
// login, adds it to `members`, stores the password, and writes .env.engine.
// Usage: npm run engine:setup [-- --id my-laptop]
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { hostname } from "node:os";
import { projectRef, loadKeys, createAdmin } from "./admin";

const KEYCHAIN_SERVICE = "away-agent-engine";

function engineIdFromArgs(): string {
  const i = process.argv.indexOf("--id");
  const raw = i >= 0 ? process.argv[i + 1] : hostname().replace(/\.local$/, "");
  const id = (raw || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Could not derive an engine id — pass one with --id.");
  return id;
}

async function main() {
  const engineId = engineIdFromArgs();
  const ref = projectRef();
  const { url, publishable, serviceRole } = loadKeys(ref);
  const admin = createAdmin(url, serviceRole);

  // Reserved .invalid TLD: no one can ever receive mail here, so password-reset
  // emails can't be used to hijack an engine account.
  const email = `engine-${engineId}@awayagent.invalid`;
  const password = randomBytes(32).toString("base64url");
  const user = await admin.upsertUser(email, password, { awayagent_role: "engine", engine_id: engineId });
  await admin.grant(user.id, "engine", engineId);

  const env: Record<string, string> = {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishable,
    ENGINE_ID: engineId,
    ENGINE_EMAIL: email,
  };
  if (process.platform === "darwin") {
    execFileSync("security", ["add-generic-password", "-a", engineId, "-s", KEYCHAIN_SERVICE, "-w", password, "-U"]);
  } else {
    env.ENGINE_PASSWORD = password;
  }
  writeFileSync(".env.engine", Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(".env.engine", 0o600);

  console.log(`Engine "${engineId}" registered.`);
  console.log(process.platform === "darwin" ? `Password stored in Keychain (${KEYCHAIN_SERVICE} / ${engineId}).` : "Password stored in .env.engine (0600).");
  console.log("Start it with: npm run engine");
}

main().catch((e) => {
  console.error("engine setup failed:", e.message);
  process.exit(1);
});

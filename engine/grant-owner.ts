// Makes an existing Supabase Auth user (created in the dashboard) an AwayAgent owner.
// Usage: npm run hub:grant-owner -- you@example.com
import { projectRef, loadKeys, createAdmin } from "./admin";

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: npm run hub:grant-owner -- you@example.com");
  const { url, serviceRole } = loadKeys(projectRef());
  const admin = createAdmin(url, serviceRole);
  const user = await admin.findUser(email);
  if (!user) throw new Error(`No user ${email} — create it first in Supabase → Authentication → Users → Add user.`);
  await admin.grant(user.id, "owner", email);
  console.log(`${email} is now an AwayAgent owner.`);
}

main().catch((e) => {
  console.error("grant failed:", e.message);
  process.exit(1);
});

// Frees an account's single active-login slot right away (e.g. the signed-in
// device was lost and you don't want to wait for the 10-minute idle timeout).
// Usage: npm run hub:release-login -- you@example.com
import { projectRef, loadKeys, createAdmin } from "./admin";

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: npm run hub:release-login -- you@example.com");
  const { url, serviceRole } = loadKeys(projectRef());
  const user = await createAdmin(url, serviceRole).findUser(email);
  if (!user) throw new Error(`No user ${email}`);
  const res = await fetch(`${url}/rest/v1/active_logins?user_id=eq.${user.id}`, {
    method: "DELETE",
    headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`release failed: ${res.status} ${await res.text()}`);
  const released = (await res.json()) as { device_label: string | null }[];
  console.log(
    released.length
      ? `Released ${email}'s login slot (was held by ${released[0].device_label ?? "unknown device"}). That device loses access within a minute.`
      : `${email} had no active login.`
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

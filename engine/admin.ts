import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Admin helpers for setup scripts only. The service-role key is fetched from the
// Supabase CLI (your logged-in account) at run time and never written to disk —
// engines and browsers only ever hold the publishable key plus their own login.

type ApiKey = { name: string; type: string; api_key: string };

export function projectRef(): string {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const refFile = join(process.cwd(), "supabase", ".temp", "project-ref");
  if (existsSync(refFile)) return readFileSync(refFile, "utf8").trim();
  throw new Error("No linked Supabase project — run `supabase link` or set SUPABASE_PROJECT_REF.");
}

export function loadKeys(ref: string) {
  const raw = execFileSync("supabase", ["projects", "api-keys", "--project-ref", ref, "-o", "json"], {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  const keys: ApiKey[] = JSON.parse(raw);
  const publishable = keys.find((k) => k.type === "publishable")?.api_key ?? keys.find((k) => k.name === "anon")?.api_key;
  const serviceRole = keys.find((k) => k.name === "service_role")?.api_key;
  if (!publishable || !serviceRole) throw new Error("Could not read project API keys from the Supabase CLI.");
  return { url: `https://${ref}.supabase.co`, publishable, serviceRole };
}

export function createAdmin(url: string, serviceRole: string) {
  const headers = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}`, "Content-Type": "application/json" };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  type User = { id: string; email: string };

  async function findUser(email: string): Promise<User | null> {
    for (let page = 1; ; page++) {
      const { users } = await call<{ users: User[] }>(`/auth/v1/admin/users?page=${page}&per_page=200`);
      const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (hit) return hit;
      if (users.length < 200) return null;
    }
  }

  async function upsertUser(email: string, password: string, appMetadata: Record<string, unknown>): Promise<User> {
    const existing = await findUser(email);
    if (existing) {
      return call<User>(`/auth/v1/admin/users/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ password, app_metadata: appMetadata }),
      });
    }
    return call<User>("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: appMetadata }),
    });
  }

  async function grant(userId: string, role: "owner" | "engine", label: string): Promise<void> {
    await call("/rest/v1/members?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, role, label }),
    });
  }

  return { findUser, upsertUser, grant };
}

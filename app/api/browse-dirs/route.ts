import { NextResponse } from "next/server";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { HOME } from "@/lib/server/env";

// Lists immediate subdirectories of `path` (default: home) for the New Session
// folder browser — names and full paths only, never file contents. Hidden
// dotfolders (.git, .claude, ...) are skipped as picker noise, not a security
// boundary — this is a single-user, auth-gated tool with no path restriction.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || HOME;

  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return NextResponse.json({ error: `Not a directory: ${path}` }, { status: 400 });
  }

  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return NextResponse.json({ error: `Cannot read: ${path}` }, { status: 400 });
  }

  const dirs = entries
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(join(path, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: join(path, name) }));

  const parent = path === HOME ? null : dirname(path);
  return NextResponse.json({ path, parent, dirs });
}

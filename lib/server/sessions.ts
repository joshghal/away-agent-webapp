import { readFileSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./env";
import type { HistoryItem, ImagePart } from "../shared/ws-protocol";

const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects");

export function encodeProjectPath(p: string): string {
  return p.replace(/\//g, "-");
}

// Strip leading auto-injected context blocks (VS Code sends these ahead of what the
// user actually typed, e.g. <ide_opened_file>...</ide_opened_file>can you...) so the
// title/history reflects the real message, not IDE boilerplate.
export function stripInjectedContext(text: string | null | undefined): string | null {
  if (!text) return null;
  const stripped = text.replace(/^(\s*<([a-zA-Z_-]+)>[\s\S]*?<\/\2>\s*)+/, "").trim();
  return stripped || null;
}

// Shared by the live event path and history replay — a tool_result's content can
// mix text and image blocks (confirmed via a real Playwright screenshot: {type:
// "image", source:{type:"base64", media_type, data}}); split them so images can be
// rendered as actual <img> tags instead of dumped as raw base64 text.
export function extractToolResultParts(rawContent: unknown): { text: string; images: ImagePart[] } {
  const textParts: string[] = [];
  const images: ImagePart[] = [];
  if (typeof rawContent === "string") {
    textParts.push(rawContent);
  } else if (Array.isArray(rawContent)) {
    for (const c of rawContent) {
      if (c.type === "text") textParts.push(c.text);
      else if (c.type === "image" && c.source?.data) {
        images.push({ mediaType: c.source.media_type || "image/png", data: c.source.data });
      } else {
        textParts.push(JSON.stringify(c));
      }
    }
  } else {
    textParts.push(JSON.stringify(rawContent));
  }
  return { text: textParts.join("\n"), images };
}

function readFirstBytes(path: string, n: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = readSync(fd, buf, 0, n, 0);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// sessions-index.json (Claude Code's own per-project index, with nice auto-generated
// titles) is ONLY maintained by the interactive CLI/VS Code — headless `-p` sessions
// never register there, so it silently goes stale for our purposes. Source of truth
// is the actual .jsonl transcripts on disk; the index is used only as a title
// enhancement when it happens to have an entry.
function loadSummaryIndex(): Map<string, string> {
  const summaryById = new Map<string, string>();
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return summaryById;
  for (const name of readdirSync(CLAUDE_PROJECTS_DIR)) {
    const indexPath = join(CLAUDE_PROJECTS_DIR, name, "sessions-index.json");
    if (!existsSync(indexPath)) continue;
    try {
      const data = JSON.parse(readFileSync(indexPath, "utf8"));
      for (const e of data.entries || []) if (e.summary) summaryById.set(e.sessionId, e.summary);
    } catch {
      // ignore malformed index files
    }
  }
  return summaryById;
}

type SessionMeta = { cwd: string | null; firstUserText: string | null; messageCount: number };

// Only reads a bounded prefix of each transcript — cwd and the first user message
// always appear near the start, and some session files run into the tens of MB, so
// reading them in full just to build a picker list is needless.
function readSessionMeta(jsonlPath: string): SessionMeta | null {
  let head: string;
  try {
    head = readFirstBytes(jsonlPath, 32768);
  } catch {
    return null;
  }
  const lines = head.split("\n");
  lines.pop(); // last line is likely cut off mid-JSON at the byte boundary
  let cwd: string | null = null;
  let firstUserText: string | null = null;
  let messageCount = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    if (obj.type === "user" || obj.type === "assistant") messageCount++;
    if (!firstUserText && obj.type === "user") {
      const content = obj.message?.content;
      let text: string | null = null;
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        const textBlock = content.find((c: any) => c.type === "text" && c.text);
        if (textBlock) text = textBlock.text;
      }
      const cleaned = stripInjectedContext(text);
      if (cleaned) firstUserText = cleaned;
    }
  }
  return { cwd, firstUserText, messageCount };
}

export type DirSession = { sessionId: string; title: string; modified: string; messageCount: number };
export type Dir = { projectPath: string; sessions: DirSession[] };

export function listDirectories(): Dir[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  const summaryById = loadSummaryIndex();
  const byProject = new Map<string, DirSession[]>();

  for (const name of readdirSync(CLAUDE_PROJECTS_DIR)) {
    const dirPath = join(CLAUDE_PROJECTS_DIR, name);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.slice(0, -".jsonl".length);
      const fullPath = join(dirPath, file);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size === 0) continue;
      const meta = readSessionMeta(fullPath);
      if (!meta || !meta.cwd || !existsSync(meta.cwd)) continue;

      const title = summaryById.get(sessionId) || meta.firstUserText?.slice(0, 70) || "Untitled session";
      if (!byProject.has(meta.cwd)) byProject.set(meta.cwd, []);
      byProject.get(meta.cwd)!.push({
        sessionId,
        title,
        modified: stat.mtime.toISOString(),
        messageCount: meta.messageCount,
      });
    }
  }

  const dirs: Dir[] = [];
  for (const [projectPath, sessions] of byProject) {
    sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    dirs.push({ projectPath, sessions: sessions.slice(0, 25) });
  }
  dirs.sort((a, b) => new Date(b.sessions[0].modified).getTime() - new Date(a.sessions[0].modified).getTime());
  return dirs;
}

export function transcriptModifiedAt(project: string, sessionId: string): number | null {
  try {
    return statSync(join(CLAUDE_PROJECTS_DIR, encodeProjectPath(project), `${sessionId}.jsonl`)).mtimeMs;
  } catch {
    return null;
  }
}

export function readHistory(project: string, sessionId: string): HistoryItem[] {
  const dir = join(CLAUDE_PROJECTS_DIR, encodeProjectPath(project));
  const file = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  const items: HistoryItem[] = [];
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    if (obj.type === "user") {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          items.push({
            type: "user_message",
            text: stripInjectedContext(block.text) || "(opened a file in the IDE)",
          });
        } else if (block.type === "tool_result") {
          const { text, images } = extractToolResultParts(block.content);
          items.push({
            type: "tool_result",
            tool_use_id: block.tool_use_id,
            content: text,
            images,
            is_error: !!block.is_error,
          });
        }
      }
    } else if (obj.type === "assistant") {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          items.push({ type: "assistant_text", text: block.text, standalone: true });
        } else if (block.type === "tool_use") {
          items.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
      }
    }
  }
  return items;
}

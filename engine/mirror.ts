import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readHistory, encodeProjectPath } from "../lib/server/sessions";
import { HOME } from "../lib/server/env";
import type { HistoryItem, ImagePart } from "../lib/shared/ws-protocol";

const IMAGE_BUCKET = "transcript-images";
// Screenshots only for sessions active in the last day — full image backfill of
// every old transcript would blow through the free storage tier for little value.
const IMAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STORED_TOOL_RESULT_MAX = 8_000;
const STORED_INPUT_STRING_MAX = 4_000;
const STORED_TEXT_MAX = 50_000;
const INSERT_BATCH = 100;

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}

export function clampStrings(value: unknown, max: number): unknown {
  if (typeof value === "string") return clampText(value, max);
  if (Array.isArray(value)) return value.map((v) => clampStrings(v, max));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clampStrings(v, max)]));
  }
  return value;
}

// Postgres jsonb rejects NUL characters and lone UTF-16 surrogates (e.g. an emoji
// cut in half by an upstream truncation) — both turn up in real transcripts.
export function jsonbSafe(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\u0000", "").toWellFormed();
  if (Array.isArray(value)) return value.map(jsonbSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonbSafe(v)]));
  }
  return value;
}

const EXT: Record<string, string> ={ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export function createImageUploader(supabase: SupabaseClient) {
  const uploads = new Map<string, Promise<string | null>>();

  function upload(img: ImagePart): Promise<string | null> {
    if (img.path) return Promise.resolve(img.path);
    if (!img.data) return Promise.resolve(null);
    const bytes = Buffer.from(img.data, "base64");
    const path = `img/${createHash("sha256").update(bytes).digest("hex")}.${EXT[img.mediaType] || "png"}`;
    let pending = uploads.get(path);
    if (!pending) {
      pending = supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, bytes, { contentType: img.mediaType, upsert: false })
        .then(({ error }) => {
          // Content-addressed path: "already exists" means the same bytes are already there.
          if (error && !/exists|duplicate/i.test(error.message)) {
            console.error("image upload failed:", error.message);
            uploads.delete(path);
            return null;
          }
          return path;
        });
      uploads.set(path, pending);
    }
    return pending;
  }

  async function uploadAll(images: ImagePart[]): Promise<ImagePart[]> {
    const out: ImagePart[] = [];
    for (const img of images) {
      const path = await upload(img);
      if (path) out.push({ mediaType: img.mediaType, path });
    }
    return out;
  }

  return { uploadAll };
}

export type ImageUploader = ReturnType<typeof createImageUploader>;

function transcriptPath(project: string, sessionId: string): string {
  return join(HOME, ".claude", "projects", encodeProjectPath(project), `${sessionId}.jsonl`);
}

function titleFrom(items: HistoryItem[]): string | null {
  for (const item of items) {
    if (item.type === "user_message" && item.text && item.text !== "(opened a file in the IDE)") {
      return item.text.slice(0, 70);
    }
  }
  return null;
}

export function createMirror(supabase: SupabaseClient, engineId: string, images: ImageUploader) {
  const locks = new Map<string, Promise<void>>();

  async function toStored(item: HistoryItem, withImages: boolean): Promise<HistoryItem> {
    switch (item.type) {
      case "user_message":
        return { ...item, text: item.text === null ? null : clampText(item.text, STORED_TEXT_MAX) };
      case "assistant_text":
        return { ...item, text: clampText(item.text, STORED_TEXT_MAX) };
      case "tool_use":
        return { ...item, input: clampStrings(item.input, STORED_INPUT_STRING_MAX) };
      case "tool_result": {
        let content = clampText(item.content, STORED_TOOL_RESULT_MAX);
        let stored: ImagePart[] = [];
        if (item.images.length) {
          if (withImages) stored = await images.uploadAll(item.images);
          const missing = item.images.length - stored.length;
          if (missing > 0) content += `\n[${missing} image(s) not mirrored to the hub]`;
        }
        return { ...item, content, images: stored };
      }
    }
  }

  async function sync(project: string, sessionId: string): Promise<void> {
    let mtime: Date;
    try {
      mtime = statSync(transcriptPath(project, sessionId)).mtime;
    } catch {
      return; // no transcript on disk yet (brand-new session before its first write)
    }
    const { data: row, error: readErr } = await supabase
      .from("sessions")
      .select("message_count, title, mirrored_mtime")
      .eq("id", sessionId)
      .maybeSingle();
    if (readErr) throw new Error(`read session ${sessionId}: ${readErr.message}`);
    // Unchanged since the last mirror: skip parsing a possibly tens-of-MB transcript.
    // This is what makes opening a long session fast.
    if (row?.mirrored_mtime && Date.parse(row.mirrored_mtime) === mtime.getTime()) return;

    const items = readHistory(project, sessionId);
    const withImages = Date.now() - mtime.getTime() < IMAGE_WINDOW_MS;

    if (!row) {
      const { error } = await supabase.from("sessions").insert({
        id: sessionId,
        project_path: project,
        engine_id: engineId,
        title: titleFrom(items),
        last_message_at: mtime.toISOString(),
      });
      if (error && !/duplicate/i.test(error.message)) throw new Error(`create session ${sessionId}: ${error.message}`);
    }

    let from = row?.message_count ?? 0;
    if (items.length < from) {
      // Transcript shrank (rewritten/compacted) — rebuild from scratch.
      await supabase.from("session_events").delete().eq("session_id", sessionId);
      from = 0;
    }

    const fresh = items.slice(from);
    for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
      const batch = await Promise.all(fresh.slice(i, i + INSERT_BATCH).map((item) => toStored(item, withImages)));
      const { error } = await supabase
        .from("session_events")
        .insert(batch.map((payload) => ({ session_id: sessionId, type: payload.type, payload: jsonbSafe(payload) })));
      if (error) throw new Error(`insert events for ${sessionId}: ${error.message}`);
      // Advance the stored count per batch so an interrupted sync resumes instead of duplicating.
      await supabase.from("sessions").update({ message_count: from + i + batch.length }).eq("id", sessionId);
    }

    const update: Record<string, unknown> = {
      message_count: items.length,
      last_message_at: mtime.toISOString(),
      mirrored_mtime: mtime.toISOString(),
    };
    if (!row?.title) {
      const title = titleFrom(items);
      if (title) update.title = title;
    }
    await supabase.from("sessions").update(update).eq("id", sessionId);
  }

  // Serialized per session: overlapping syncs would both insert the same tail.
  function syncSession(project: string, sessionId: string): Promise<void> {
    const prev = locks.get(sessionId) || Promise.resolve();
    const run = prev.then(() => sync(project, sessionId));
    const settled = run.catch((e) => console.error("mirror:", e.message));
    locks.set(sessionId, settled);
    settled.then(() => {
      if (locks.get(sessionId) === settled) locks.delete(sessionId);
    });
    return settled;
  }

  return { syncSession };
}

export type Mirror = ReturnType<typeof createMirror>;

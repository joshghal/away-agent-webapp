import type { ServerMessage } from "../lib/shared/ws-protocol";
import { clampStrings, clampText, type ImageUploader } from "./mirror";

// Realtime messages are capped (256 KB on the free tier); keep live payloads well under it.
const LIVE_TOOL_RESULT_MAX = 60_000;
const LIVE_INPUT_STRING_MAX = 20_000;
// Token deltas arrive dozens of times a second; batching them keeps Realtime
// message volume (and the free tier's monthly quota) sane without visible lag.
const DELTA_FLUSH_MS = 100;

export type Publish = (to: string | null, msg: ServerMessage) => Promise<void>;

type DeltaType = "assistant_text_delta" | "thinking_delta";

export function createOutbound(to: string | null, publish: Publish, images: ImageUploader) {
  let queue: Promise<void> = Promise.resolve();
  let pendingDelta: { type: DeltaType; text: string } | null = null;
  let flushTimer: NodeJS.Timeout | null = null;

  async function prepare(msg: ServerMessage): Promise<ServerMessage> {
    switch (msg.type) {
      case "tool_result":
        return {
          ...msg,
          content: clampText(msg.content, LIVE_TOOL_RESULT_MAX),
          images: msg.images.length ? await images.uploadAll(msg.images) : [],
        };
      case "tool_use":
        return { ...msg, input: clampStrings(msg.input, LIVE_INPUT_STRING_MAX) };
      case "approval_request":
        return { ...msg, input: clampStrings(msg.input, LIVE_INPUT_STRING_MAX) };
      default:
        return msg;
    }
  }

  function enqueue(msg: ServerMessage): void {
    queue = queue
      .then(async () => publish(to, await prepare(msg)))
      .catch((e) => console.error("outbound publish failed:", e?.message || e));
  }

  function flushDelta(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingDelta) {
      enqueue(pendingDelta);
      pendingDelta = null;
    }
  }

  function send(msg: ServerMessage): void {
    if (msg.type === "assistant_text_delta" || msg.type === "thinking_delta") {
      if (pendingDelta && pendingDelta.type !== msg.type) flushDelta();
      if (pendingDelta) pendingDelta.text += msg.text;
      else pendingDelta = { type: msg.type, text: msg.text };
      flushTimer ??= setTimeout(flushDelta, DELTA_FLUSH_MS);
      return;
    }
    flushDelta(); // keep ordering: buffered text goes out before whatever follows it
    enqueue(msg);
  }

  return { send };
}

import { supabase } from "./supabase";

// One active web login per account, enforced in the database (see the
// single_login migration). These helpers claim, renew and release that slot.

export type SlotResult = { granted: boolean; holderDevice: string | null; holderLastSeen: string | null };

const HEARTBEAT_MS = 60_000;
export const KICKED_NOTICE_KEY = "away-agent:kickedNotice";

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Linux";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua) || /CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${device} · ${browser}`;
}

export async function claimSlot(): Promise<SlotResult> {
  const { data, error } = await supabase.rpc("claim_login", { p_device_label: deviceLabel() });
  if (error) throw new Error(error.message);
  const row = (data as { granted: boolean; holder_device: string | null; holder_last_seen: string | null }[])[0];
  return { granted: !!row?.granted, holderDevice: row?.holder_device ?? null, holderLastSeen: row?.holder_last_seen ?? null };
}

export async function releaseSlot(): Promise<void> {
  await supabase.rpc("release_login");
}

// Renews the slot every minute and whenever the page comes back into view. If
// another device took it over (this one went idle 10+ minutes), onLost fires.
export function startSlotHeartbeat(onLost: (holder: SlotResult) => void): () => void {
  let stopped = false;
  async function beat() {
    if (stopped) return;
    try {
      const result = await claimSlot();
      if (!result.granted && !stopped) onLost(result);
    } catch {
      // network blip: try again next beat
    }
  }
  const timer = setInterval(beat, HEARTBEAT_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void beat();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/client/supabase";
import type { ImagePart } from "@/lib/shared/ws-protocol";

const SIGNED_URL_TTL_S = 60 * 60;
const signedUrls = new Map<string, Promise<string | null>>();

// The bucket is private (members only), so images are shown through short-lived signed URLs.
function signedUrl(path: string): Promise<string | null> {
  let pending = signedUrls.get(path);
  if (!pending) {
    pending = supabase.storage
      .from("transcript-images")
      .createSignedUrl(path, SIGNED_URL_TTL_S)
      .then(({ data }) => data?.signedUrl ?? null);
    signedUrls.set(path, pending);
    setTimeout(() => signedUrls.delete(path), (SIGNED_URL_TTL_S - 60) * 1000);
  }
  return pending;
}

export function TranscriptImage({ img, expanded, onToggle }: { img: ImagePart; expanded: boolean; onToggle: () => void }) {
  const [src, setSrc] = useState<string | null>(img.data ? `data:${img.mediaType};base64,${img.data}` : null);

  useEffect(() => {
    if (img.path) void signedUrl(img.path).then(setSrc);
  }, [img.path]);

  if (!src) return <div className="rounded-lg mt-2 h-24 bg-black/22 animate-pulse" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URLs; next/image optimization doesn't apply
    <img
      src={src}
      alt="screenshot"
      onClick={onToggle}
      className={`block rounded-lg mt-2 ${expanded ? "max-w-none w-full cursor-zoom-out" : "max-w-full cursor-zoom-in"}`}
    />
  );
}

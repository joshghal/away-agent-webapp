"use client";
import { useEffect, useRef, useState } from "react";

// "Are we near the bottom" itself stays a plain ref, not state — putting THAT in
// a store would re-render on every scroll tick, a real perf regression the
// original (a plain `let autoScroll`) never had. `showJumpButton` is real state,
// but it's a boolean that only actually changes value when crossing the
// near-bottom threshold — React bails out of re-rendering on a same-value
// update, so this doesn't reintroduce the per-tick cost.
export function useAutoScroll(logRef: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const autoScrollRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      autoScrollRef.current = nearBottom;
      setShowJumpButton(!nearBottom);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [logRef]);

  useEffect(() => {
    const el = logRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const forceScrollDown = () => {
    autoScrollRef.current = true;
    setShowJumpButton(false);
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return { forceScrollDown, showJumpButton };
}

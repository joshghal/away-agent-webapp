import { cx } from "./cx";

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("w-[13px] h-[13px] rounded-full border-2 border-white/25 border-t-white animate-spin-slow", className)} />;
}

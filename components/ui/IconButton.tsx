import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

// Square icon-only button. `size` is the pixel width/height; `radius` the corner.
const SIZE = {
  18: "w-[18px] h-[18px]",
  22: "w-[22px] h-[22px]",
  28: "w-7 h-7",
  32: "w-8 h-8",
  34: "w-[34px] h-[34px]",
  36: "w-9 h-9",
} as const;
const RADIUS = { md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl", full: "rounded-full" } as const;
const TONE = {
  default: "transition-colors disabled:opacity-50 text-text-2 hover:bg-hover hover:text-text-1",
  muted: "transition-colors disabled:opacity-50 text-text-3 hover:bg-active hover:text-text-1",
  danger: "transition-colors disabled:opacity-50 text-text-3 hover:text-danger hover:bg-danger-soft",
  accent: "transition-opacity disabled:opacity-50 text-accent-2 hover:bg-active",
  // Filled gradient, e.g. a send button.
  primary: "text-white bg-gradient-to-br from-accent-2 to-accent-strong disabled:opacity-30 active:scale-90 transition-transform",
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: keyof typeof SIZE;
  radius?: keyof typeof RADIUS;
  tone?: keyof typeof TONE;
  // Required: an icon alone has no accessible name.
  "aria-label": string;
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { size = 34, radius = "lg", tone = "default", className, type = "button", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("flex-none flex items-center justify-center", SIZE[size], RADIUS[radius], TONE[tone], className)}
      {...rest}
    >
      {children}
    </button>
  );
});

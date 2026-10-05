import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "success" | "danger" | "tinted" | "outline" | "outlineDanger" | "subtle" | "secondary";
// form: login-style block button · md: inline sheet action · lg: full-width CTA
// block: card actions (pair with flex-1) · xl: roomy sheet/list button · xs: compact
export type ButtonSize = "xs" | "md" | "form" | "block" | "lg" | "xl" | "field";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "font-semibold text-white bg-gradient-to-br from-accent-2 to-accent-strong",
  success: "font-semibold bg-success text-[#06281d]",
  danger: "font-semibold bg-danger text-[#2b0a10]",
  tinted:
    "font-semibold bg-accent-soft border border-accent-soft-border text-accent-2 hover:bg-accent/20 transition-colors active:scale-[0.98]",
  outline: "font-medium border border-panel-border text-text-1 hover:bg-hover transition-colors",
  outlineDanger: "font-medium border border-danger/30 text-danger hover:bg-danger-soft transition-colors",
  subtle: "border border-panel-border-soft text-text-2 hover:text-text-1 hover:bg-hover",
  secondary: "font-medium bg-panel-strong border border-panel-border-soft text-text-2 hover:text-text-1 transition-colors",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "rounded-lg px-2.5 py-1 text-[12px]",
  md: "rounded-lg py-2.5 px-4 text-[13px]",
  form: "rounded-lg py-2.5 text-[13.5px] flex items-center justify-center gap-2",
  block: "rounded-lg py-2 text-[13px]",
  lg: "rounded-xl py-3.5 text-[14px] active:scale-[0.98] transition-transform",
  xl: "rounded-xl py-3 text-[13.5px]",
  // Sits beside a text field and stretches to its height.
  field: "rounded-lg px-3.5 text-[12.5px]",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Shows a spinner before the label and ignores clicks while true.
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", busy = false, className, disabled, children, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={cx(VARIANT[variant], SIZE[size], "disabled:opacity-40 disabled:cursor-not-allowed", className)}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
});

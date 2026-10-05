import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";

const BASE =
  "bg-black/22 border border-panel-border-soft text-text-1 outline-none focus:border-accent-soft-border placeholder:text-text-3";

// xs: dense inline row · sm: sheet field · md: login form · lg: roomy form field
const SIZE = {
  xs: "rounded-lg py-2 px-2.5 text-[12.5px]",
  sm: "rounded-lg py-2.5 px-2.5 text-[13px]",
  md: "rounded-lg py-2.5 px-3 text-[13.5px]",
  lg: "rounded-xl px-3 py-2.5 text-[14px]",
} as const;

export type FieldSize = keyof typeof SIZE;

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { size?: never; fieldSize?: FieldSize }>(
  function TextInput({ fieldSize = "md", className, ...rest }, ref) {
    return <input ref={ref} className={cx(BASE, SIZE[fieldSize], className)} {...rest} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cx(BASE, "w-full resize-none rounded-xl p-3 text-[14px] leading-relaxed", className)}
      {...rest}
    />
  );
});

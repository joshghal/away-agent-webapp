import { cx } from "./cx";

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  ...rest
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative w-9 h-5 rounded-full flex-none transition-colors", checked ? "bg-accent-strong" : "bg-white/15")}
      {...rest}
    >
      <span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

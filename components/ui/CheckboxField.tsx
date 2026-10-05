import type { ReactNode } from "react";

// A checkbox with a title and a one-line explanation, clickable as a whole.
export function CheckboxField({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 accent-[var(--color-accent)] flex-none"
      />
      <div>
        <div className="text-[13px] text-text-1 font-medium">{label}</div>
        {description && <div className="text-[11.5px] text-text-3 mt-0.5">{description}</div>}
      </div>
    </label>
  );
}

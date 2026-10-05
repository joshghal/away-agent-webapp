import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons/icons";

export function Alert({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="mx-3 mt-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger flex gap-2 items-start flex-none"
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          <CloseIcon className="w-4 h-4 opacity-60" />
        </button>
      )}
    </div>
  );
}

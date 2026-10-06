"use client";
import { useEffect } from "react";

const TEXT_FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=true]";

// On a phone, tapping a button while a text field is focused moves focus to the
// button: the keyboard closes, the viewport resizes, the layout shifts under the
// finger and the tap never becomes a click — so every submit took two taps.
// Cancelling the (touch-synthesised) mousedown keeps focus in the field, so the
// first tap goes straight through. Dropdown triggers opt out via aria-haspopup:
// their menu would otherwise open behind the keyboard.
export function KeyboardGuard() {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const button = target?.closest?.("button");
      if (!button || button.hasAttribute("aria-haspopup")) return;
      const active = document.activeElement;
      if (active && active !== button && active.matches(TEXT_FIELD)) e.preventDefault();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);
  return null;
}

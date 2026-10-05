import clsx from "clsx";

// Join class names, skipping falsy values. Primitives only accept `className` for
// layout (width, margin, flex); style variants go through their props so two
// conflicting Tailwind classes never end up on one element.
export const cx = clsx;

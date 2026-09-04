"use client";

import { cn } from "cn";

/**
 * The stencil "S" mark — CSS-only clip-path (`s-mark` utility, globals.css),
 * filled with currentColor. Purely decorative: loading indicator, watermark,
 * chat send-glyph. Never redraw the real logo mark from this approximation.
 */
export function SMark({ className }: { className?: string }) {
  return <div aria-hidden className={cn("s-mark size-5", className)} />;
}

"use client";

import { cn } from "cn";

/**
 * The stencil "S" mark — the real one, traced 1:1 from the wordmark in
 * `old-soulless-bg.jpeg` (design-visual-identity.md §1: "reuse 1:1, never
 * redraw"). This replaces the CSS `s-mark` clip-path approximation that used
 * to live in globals.css; that shape scored 40% pixel-IoU against the source,
 * this one scores 96.5%.
 *
 * The mark is TWO disjoint arms, not one zig-zag block: an upper arrow whose
 * top and bottom edges splay symmetrically off a vertical left edge (with a
 * wedge bitten out of its right side), and a lower slanted bar. The wide
 * diagonal void between them is the logo's cut — it is the mark, so the two
 * paths must never be merged or nudged toward each other.
 *
 * Every coordinate is a least-squares fit of the source raster's edges, then
 * normalised from the mark's true 149.2 × 279.6 px bbox onto a 160 × 300
 * viewBox (aspect 0.533). They are MEASURED, not designed — don't round them
 * to a grid or "regularise" the near-symmetries; the asymmetries are real.
 *
 * Sizing defaults to `h-5 w-auto` — height-driven, intrinsic width off the
 * viewBox — which is what the lockups beside text want. The centred decorative
 * uses (watermarks, the loading indicator) pass `size-*` instead and get a
 * square box; `preserveAspectRatio` is left at its default, so there the glyph
 * fills the height and centres. Do NOT default this to `size-*`: `cn` keeps
 * both `size-5` and a caller's `w-auto`, and which one wins is then down to
 * Tailwind's emitted rule order rather than anything written here.
 */
export function SMark({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 160 300"
      fill="currentColor"
      style={style}
      className={cn("h-5 w-auto", className)}
    >
      {/* upper arm: right edge, cut diagonal, wedge, stem, lower splay, left edge */}
      <path d="M160 0 V35.4 L55.2 92.2 L80.5 107.1 V152.1 L0.9 121.4 V61.6 Z" />
      {/* lower arm */}
      <path d="M160 151 V189.5 L0 300 V238.2 Z" />
    </svg>
  );
}

"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";

/**
 * The `ALPHA` sticker on the wordmark (owner ruling 2026-09-08). A small
 * rotated tag perched on the lockup's right shoulder, the way a game title
 * wears an "early access" tag — jade text on `jade-wash` with a `jade-border`
 * hairline, i.e. the top bar's `+5` micro-tag vocabulary, tilted.
 *
 * It sits on exactly two surfaces: the auth hero lockup (`auth/auth-page.tsx`)
 * and the top bar's S-mark (`shell/top-bar.tsx`). It is a wordmark tag, not a
 * banner — `plan-hosted-early-access.md` D8's "no alpha banner" still holds
 * for anything bigger than this. When the alpha ends, delete the two call
 * sites and this file; nothing else knows it exists.
 *
 * The 22° tilt is a deliberate, TEMPORARY exception to design-visual-identity.md
 * §4.3's single-angle rule: the tilt is what makes the tag read as "test build"
 * rather than a product tier. Don't reuse this angle anywhere else — it leaves
 * with the tag.
 *
 * Tailwind v4's `rotate-*` / `translate-*` write the individual `rotate:` /
 * `translate:` properties, so callers may add more classes without clobbering
 * each other axis-for-axis — but two utilities touching the SAME axis don't
 * stack, the later one in emitted rule order simply wins (see `s-mark.tsx`'s
 * note on the same hazard for `size-*` vs `w-auto`). That's why the
 * shoulder-perch offset is baked in per `size` rather than left for a caller
 * to nudge on top of a shared default: the auth hero's wide "SL" wordmark and
 * the top bar's bare, much narrower S-mark need genuinely different offsets,
 * not just different type sizes — an offset tuned for the wordmark buries the
 * tag in the S-mark. `origin-bottom-left` is what makes the tag lift off the
 * lockup's shoulder instead of spinning in place.
 *
 * `size` is also a prop rather than a caller className for the plain reason
 * `cn` here is plain concatenation, not tailwind-merge — two `text-[…px]`
 * classes would both apply and the winner would be down to emitted rule
 * order. Padding is in `em` so the chip scales with the type it holds.
 */
export function AlphaTag({
  size = "sm",
  className,
}: {
  /** `sm` = top bar's bare S-mark; `md` = auth hero's full "SL" wordmark. */
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useTranslations("alphaTag");

  return (
    <span
      className={cn(
        "inline-block shrink-0 origin-bottom-left rotate-22 select-none whitespace-nowrap rounded-sm border border-jade-border bg-jade-wash px-[0.3em] py-[0.1em] font-semibold uppercase leading-none tracking-widest text-jade",
        size === "md"
          ? "text-[11px] -translate-x-5 -translate-y-5"
          : "text-[9px] -translate-x-1 translate-y-1",
        className,
      )}
    >
      {t("label")}
    </span>
  );
}

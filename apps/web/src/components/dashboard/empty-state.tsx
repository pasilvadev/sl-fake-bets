"use client";

import { cn } from "cn";
import { SMark } from "@/components/sl/s-mark";

/**
 * Shared ghost pattern (design-visual-identity.md §5.10): oversized S-mark
 * watermark at 5% opacity, one dry line, one optional primary CTA. Reused
 * across the dashboard feed, poor podium, transaction history, chat, and
 * participant list empty states — not bespoke per surface.
 */
export function EmptyState({
  line,
  ctaLabel,
  onCta,
}: {
  line: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="relative py-16 text-center">
      <SMark
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 size-32",
          "-translate-x-1/2 -translate-y-1/2 opacity-5",
        )}
      />
      <p className="relative text-sm text-muted-foreground">{line}</p>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          className={cn(
            "cut-sm relative mt-4 inline-flex h-9 items-center rounded-none",
            "bg-jade px-4 text-xs font-semibold uppercase text-black",
            "transition motion-safe:hover:brightness-110 motion-safe:active:brightness-95",
          )}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

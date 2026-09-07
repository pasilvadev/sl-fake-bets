"use client";

import { cn } from "cn";
import { useLocale } from "next-intl";
import { formatCoins } from "@/lib/format";

/** Mini S-mark glyph, ~0.75em, currentColor — the coin glyph (§5.5). */
function CoinGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("s-mark inline-block shrink-0", className)}
      style={{ width: "0.75em", height: "0.75em" }}
    />
  );
}

/** Coin glyph + mono tabular-nums value. e.g. "◆ 12,450" */
export function CoinAmount({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  // Read here rather than threaded down from every caller: this is a leaf, it
  // is the single most-rendered numeral in the app, and the grouping separator
  // is the only thing about it that varies (D7).
  const locale = useLocale();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums",
        className,
      )}
    >
      <CoinGlyph />
      {formatCoins(locale, amount)}
    </span>
  );
}

/**
 * Win/loss delta glyph vocabulary (§5.2/§5.5): gain "/ +240" jade,
 * loss "\ −180" rust (--negative), zero "±0" muted. font-mono tabular-nums.
 * The glyph still carries the meaning on its own — rust is a second channel on
 * top of "/" vs "\", not a replacement for it.
 */
export function CoinDelta({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  // Above the zero branch: hooks are unconditional, and the ±0 case is the
  // one that returns early.
  const locale = useLocale();

  if (amount === 0) {
    return (
      <span className={cn("font-mono tabular-nums text-muted-foreground", className)}>
        ±0
      </span>
    );
  }

  if (amount > 0) {
    return (
      <span className={cn("font-mono tabular-nums text-jade", className)}>
        {`/ +${formatCoins(locale, amount)}`}
      </span>
    );
  }

  return (
    <span className={cn("font-mono tabular-nums text-negative", className)}>
      {`\\ −${formatCoins(locale, Math.abs(amount))}`}
    </span>
  );
}

"use client";

import { cn } from "cn";
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums",
        className,
      )}
    >
      <CoinGlyph />
      {formatCoins(amount)}
    </span>
  );
}

/**
 * Win/loss delta glyph vocabulary (§5.2/§5.5): gain "/ +240" jade,
 * loss "\ −180" muted N6, zero "±0" muted. font-mono tabular-nums.
 */
export function CoinDelta({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
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
        {`/ +${formatCoins(amount)}`}
      </span>
    );
  }

  return (
    <span className={cn("font-mono tabular-nums text-negative", className)}>
      {`\\ −${formatCoins(Math.abs(amount))}`}
    </span>
  );
}

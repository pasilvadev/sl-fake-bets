"use client";

import { cn } from "cn";
import type { RankBadgeKind } from "@/lib/team-context";

/**
 * Inline rank badge (§5.6): a slanted parallelogram tag, never a pill.
 * "1" jade fill/black text; "2"/"3" jade border/jade text; "top5" neutral
 * border/N6 "TOP 5"; "bottom5" mirrored skew, "\" prefix, N6 text.
 */
export function RankBadge({
  kind,
  className,
}: {
  kind: RankBadgeKind;
  className?: string;
}) {
  const mirrored = kind === "bottom5";

  const label =
    kind === "top5" ? "TOP 5" : kind === "bottom5" ? "\\ BOTTOM 5" : kind;

  const toneClasses =
    kind === "1"
      ? "bg-jade text-black"
      : kind === "2" || kind === "3"
        ? "border border-jade text-jade"
        : "border border-border text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex h-4 items-center px-1.5 text-[10px] font-semibold uppercase",
        mirrored ? "skew-x-12" : "-skew-x-12",
        toneClasses,
        className,
      )}
    >
      <span className={cn("inline-block", mirrored ? "-skew-x-12" : "skew-x-12")}>
        {label}
      </span>
    </span>
  );
}

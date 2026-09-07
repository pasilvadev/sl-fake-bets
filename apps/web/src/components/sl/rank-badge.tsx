"use client";

import { cn } from "cn";
import { useTranslations } from "next-intl";
import type { RankBadgeKind } from "@/lib/team-context";

/**
 * Inline rank badge (§5.6): a slanted parallelogram tag, never a pill.
 * "1" jade fill/black text; "2"/"3" jade border/jade text; "top5" neutral
 * border/N6 "TOP 5"; "bottom5" mirrored skew, "\" prefix, rust border/text.
 */
export function RankBadge({
  kind,
  className,
}: {
  kind: RankBadgeKind;
  className?: string;
}) {
  const t = useTranslations("rankBadge");
  const mirrored = kind === "bottom5";

  // `kind` falls through as its own text for the numeric badges ("1", "2",
  // "3") — a numeral is the same in both languages, which is why they are not
  // catalog entries (§7's allowed-literal list).
  const label =
    kind === "top5" ? t("top5") : kind === "bottom5" ? t("bottom5") : kind;

  const toneClasses =
    kind === "1"
      ? "bg-jade text-black"
      : kind === "2" || kind === "3"
        ? "border border-jade text-jade"
        : mirrored
          ? "border border-rust-border text-rust"
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

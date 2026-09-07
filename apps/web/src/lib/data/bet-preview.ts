import {
  poolStatsFromTotals,
  type BetResolution,
  type BetState,
  type OptionPoolStat,
} from "@repo/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a bet share link shows to someone who is not in the team (UX-024 —
 * roadmap Phase 9, task 3).
 *
 * Reads the `bet_preview` RPC (20260905200000_share_previews.sql), not `bets`:
 * every domain table is scoped to the caller's teams by RLS, and the audience
 * for this data is by definition outside them — Slack's, WhatsApp's and
 * Twitter's unwrapper crawlers hold no session at all. Holding the bet id is
 * the authorization, the same trade UX-023's invite preview already makes for
 * invite codes, and the RPC returns nothing about who staked what.
 *
 * The odds come out of `poolStatsFromTotals`, the same function `getPoolStats`
 * delegates to — so a share card and the bet page cannot quote different
 * multipliers for the same pool.
 */

export interface BetPreview {
  betId: string;
  title: string;
  iconEmoji: string | null;
  state: BetState;
  closesAt: string;
  resolutionKind: BetResolution["kind"] | null;
  teamName: string;
  /** Ordered by `bet_options.position`, with live share and multiplier. */
  options: OptionPoolStat[];
  /** Total staked across every option. */
  poolTotal: number;
}

interface PreviewRow {
  bet_id: string;
  title: string;
  icon_emoji: string | null;
  state: BetState;
  closes_at: string;
  resolution_kind: BetResolution["kind"] | null;
  team_name: string;
  option_id: string;
  option_label: string;
  option_position: number;
  option_total: number;
}

/**
 * One bet, or null when the id matches nothing. Never throws: this runs inside
 * `generateMetadata`, where an exception costs the whole page, not just its
 * card.
 */
export async function fetchBetPreview(
  supabase: SupabaseClient,
  betId: string,
): Promise<BetPreview | null> {
  // A malformed id would make Postgres raise a cast error rather than return
  // no rows, and this is a path anyone can hit by editing a URL.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(betId)) {
    return null;
  }

  const { data, error } = await supabase.rpc("bet_preview", { p_bet_id: betId });
  if (error || !data) {
    if (error) console.error("[bet-preview] read failed:", error.message);
    return null;
  }

  const rows = data as PreviewRow[];
  if (rows.length === 0) return null;

  const head = rows[0]!;
  const options = poolStatsFromTotals(
    rows.map((row) => ({
      optionId: row.option_id,
      label: row.option_label,
      total: row.option_total,
    })),
  );

  return {
    betId: head.bet_id,
    title: head.title,
    iconEmoji: head.icon_emoji,
    state: head.state,
    closesAt: head.closes_at,
    resolutionKind: head.resolution_kind,
    teamName: head.team_name,
    options,
    poolTotal: options.reduce((sum, o) => sum + o.total, 0),
  };
}

/**
 * Just enough of next-intl's `Translator` for the six keys below.
 *
 * Structural rather than the real type on purpose: importing `getTranslations`
 * here would make this module server-only in a way its header does not promise,
 * and the per-key argument typing that the real `Translator` carries cannot
 * survive being passed around as a value anyway.
 */
type BetPreviewTranslator = (
  key: "betStatusVoided" | "betStatusResolved" | "betStatusClosed" | "betStatusOpen"
    | "betPoolEmpty" | "betPool" | "betDescription",
  values?: Record<string, string | number>,
) => string;

/**
 * The card's descriptive text (UX-024 asks for title, current odds AND
 * descriptive text). Odds read as payout multipliers — `2.4×` is what one coin
 * on that option returns right now — because that is the number the wager modal
 * and the bet page already show, and a share card that reinvents the notation
 * teaches the reader the wrong unit.
 *
 * The translator arrives as a parameter (UX-027, Phase 3 task 7) for the same
 * reason `lib/format.ts` takes a `locale`: this module is server-only and
 * hook-free, and `generateMetadata` — its one caller — already has to `await
 * getTranslations()` for the title beside it. The option LABELS inside `odds`
 * are user-generated and stay exactly as typed (§7).
 */
export function describeBetPreview(
  preview: BetPreview,
  t: BetPreviewTranslator,
): string {
  const odds = preview.options
    .map((o) => `${o.label} ${o.multiplier === null ? "—" : `${o.multiplier.toFixed(2)}×`}`)
    .join(" · ");

  const status =
    preview.state === "resolved"
      ? preview.resolutionKind === "void"
        ? t("betStatusVoided")
        : t("betStatusResolved")
      : preview.state === "closed"
        ? t("betStatusClosed")
        : t("betStatusOpen");

  const pool =
    preview.poolTotal === 0
      ? t("betPoolEmpty")
      : t("betPool", { coins: preview.poolTotal });

  return t("betDescription", { status, team: preview.teamName, pool, odds });
}

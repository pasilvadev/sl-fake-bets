import type { Metadata } from "next";
import { BetDetailPage } from "@/components/bet/bet-detail-page";
import { createClient } from "@/lib/supabase/server";
import { describeBetPreview, fetchBetPreview } from "@/lib/data/bet-preview";
import { SITE_NAME } from "@/lib/site";

/**
 * The bet share card (UX-024 — roadmap Phase 9, task 3): title, current odds,
 * and descriptive text, from the live pool.
 *
 * Source is the `bet_preview` RPC rather than the client-side team world: this
 * runs for a crawler with no session, and `bets` is membership-scoped by RLS.
 * The odds it quotes come from `poolStatsFromTotals`, the function
 * `getPoolStats` itself delegates to, so the card and the page cannot disagree.
 *
 * `noindex`, for the same reason as `/join/[code]`: the card is for whoever was
 * handed the link. A crawlable index of every team's bets would make DOM-030's
 * no-moderation stance a very different proposition.
 */
export async function generateMetadata({
  params,
}: PageProps<"/bet/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const preview = await fetchBetPreview(supabase, id);

  if (!preview) {
    return {
      title: "Bet not found",
      description: "This bet no longer exists, or the link is wrong.",
      robots: { index: false, follow: false },
    };
  }

  const title = preview.iconEmoji
    ? `${preview.iconEmoji} ${preview.title}`
    : preview.title;
  const description = describeBetPreview(preview);

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      // siteName and locale are repeated from the root layout on purpose: a
      // route-level `openGraph` REPLACES the inherited object rather than
      // merging into it, so anything not restated here simply vanishes from
      // the card.
      type: "article",
      siteName: SITE_NAME,
      locale: "en_US",
      title: `${title} — ${SITE_NAME}`,
      description,
      url: `/bet/${preview.betId}`,
    },
    twitter: { card: "summary", title: `${title} — ${SITE_NAME}`, description },
  };
}

/**
 * UX-015: the one allowed full-page view — bet detail. Data lives in the
 * client-side TeamProvider (root layout), so this route only unwraps params.
 */
export default async function BetRoute({ params }: PageProps<"/bet/[id]">) {
  const { id } = await params;
  return <BetDetailPage betId={id} />;
}

import type { Metadata } from "next";
import { JoinPage } from "@/components/join/join-page";
import { createClient } from "@/lib/supabase/server";
import { previewTeamByCode } from "@/lib/data/team-mutations";
import { SITE_NAME } from "@/lib/site";

/**
 * The invite card (UX-023 — roadmap Phase 9, task 3): a link pasted into a
 * group chat must show WHICH team it opens, before anyone clicks it.
 *
 * The team name comes from `team_preview_by_code`, the SECURITY DEFINER RPC
 * Phase 5 built for exactly this audience — `teams` is membership-scoped, and
 * a link unwrapper has no session at all. So the crawler and the human get the
 * same fact from the same source, and holding the code is the authorization
 * for both.
 *
 * `robots: noindex` deliberately, alongside a card that works: a social preview
 * is rendered for whoever was handed the link, while a search engine indexing
 * live invite codes would turn a private team into a public door. UX-017's SEO
 * target is the landing page, not this one.
 */
export async function generateMetadata({
  params,
}: PageProps<"/join/[code]">): Promise<Metadata> {
  const { code } = await params;
  const supabase = await createClient();
  const { preview } = await previewTeamByCode(supabase, decodeURIComponent(code));

  if (!preview) {
    return {
      title: "Invite not found",
      description: "This invite code doesn't match any team.",
      robots: { index: false, follow: false },
    };
  }

  const title = `Join ${preview.teamName}`;
  const description =
    `${preview.teamName} is betting fake coins on ${SITE_NAME} — ` +
    `${preview.memberCount} member${preview.memberCount === 1 ? "" : "s"}, ` +
    `${preview.openBetCount} open bet${preview.openBetCount === 1 ? "" : "s"}. ` +
    "No real money, ever.";

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      // siteName and locale are repeated from the root layout on purpose: a
      // route-level `openGraph` REPLACES the inherited object rather than
      // merging into it, so anything not restated here simply vanishes from
      // the card.
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: `${title} — ${SITE_NAME}`,
      description,
      url: `/join/${code}`,
    },
    twitter: { card: "summary", title: `${title} — ${SITE_NAME}`, description },
  };
}

/**
 * UX-012: an invite link routes straight into the join flow. The code is a
 * path segment rather than a query parameter so the URL survives being pasted
 * anywhere, and so a logged-out visitor's own pathname IS the destination
 * Phase 4's auth screen returns them to — no `?next=` needed.
 *
 * The preview is fetched here as well as in `generateMetadata` (Next dedupes
 * the two into one request) and handed down, so a signed-in visitor's HTML
 * already contains the team name instead of "Checking the code…" — server-
 * rendered content, which is what UX-017 asks for and what the client fetch
 * alone could not give.
 */
export default async function JoinRoute({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const decoded = decodeURIComponent(code);
  const supabase = await createClient();
  const { preview } = await previewTeamByCode(supabase, decoded);

  return <JoinPage code={decoded} initialPreview={preview} />;
}

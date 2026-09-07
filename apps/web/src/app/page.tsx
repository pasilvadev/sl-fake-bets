import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AppGate } from "@/components/app-gate";
import { SITE_NAME, siteUrl } from "@/lib/site";

/**
 * The one genuinely public page (UX-017 — roadmap Phase 9, task 4): signed out
 * it is the landing/auth screen, signed in it is the dashboard. Its metadata is
 * written for the signed-out case, because that is the only version a crawler
 * or a link unwrapper will ever see — the dashboard is behind a session.
 *
 * The description is deliberately concrete about what the app IS ("fake coins",
 * "no real money") rather than clever: UX-017 names word-of-mouth plus
 * "google an app for internal bets" as the growth path, and both AI answers and
 * search snippets are built from this sentence.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: {
      // `absolute` so this page does not take the `%s — SL` template: the
      // title already names the product.
      absolute: t("titleDefault", { siteName: SITE_NAME }),
    },
    // No `alternates` here on purpose (UX-027, i18n Phase 1). Next replaces the
    // whole `alternates` object rather than merging into it, so re-stating the
    // canonical URL the root layout already sets to the same value would
    // silently drop the layout's `languages` map with it — and this is the one
    // page whose hreflang pair actually matters, since it is the only
    // genuinely public, crawled surface (UX-017).
  };
}

/**
 * Structured data (UX-017's "AI/LLM discoverability" half — roadmap Phase 9,
 * task 4).
 *
 * Meta tags tell a crawler how to render a link; this tells an answer engine
 * what the thing IS, in the vocabulary those engines already parse. It is
 * server-rendered JSON in the document, so it costs nothing at runtime and
 * needs no client JS to be read.
 *
 * `offers: 0` is not decoration — "is this free?" and "is real money involved?"
 * are the two questions an AI summary of a betting app gets wrong, and ARC-001
 * makes the answer permanent.
 *
 * `inLanguage` since UX-027: an answer engine that quotes this description
 * should know which language it is quoting, and the description itself now
 * follows the reader (D2 — one URL, negotiated per visitor).
 */
async function structuredData() {
  const url = siteUrl().toString();
  const [t, locale] = await Promise.all([
    getTranslations("metadata"),
    getLocale(),
  ]);

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url,
    inLanguage: locale,
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    description: t("structuredDescription", { tagline: t("tagline") }),
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

export default async function Home() {
  const structured = await structuredData();

  return (
    <>
      <script
        type="application/ld+json"
        // The payload is this module's own literal — no user data reaches it,
        // which is the only condition under which this prop is safe.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }}
      />
      <AppGate />
    </>
  );
}

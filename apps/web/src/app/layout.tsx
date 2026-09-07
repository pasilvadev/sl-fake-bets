import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getLocale, getTranslations } from "next-intl/server";
import { AppProviders } from "@/components/app-providers";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { loadRequestFeatureFlags } from "@/lib/data/feature-flags";
import { LOCALES, OG_LOCALES } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";
import { SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Site-wide defaults every route inherits and may override (UX-017 — roadmap
 * Phase 9, task 4).
 *
 * `metadataBase` is the load-bearing one: without it Next emits relative
 * `og:url`/`og:image` values, which most crawlers discard outright, and the
 * dynamic cards in `join/[code]` and `bet/[id]` (UX-023/024) would resolve
 * against nothing. The title template is what lets each route name only
 * itself.
 *
 * `openGraph` and `twitter` are declared here rather than per-route so a page
 * that adds a card inherits site name, locale and type for free — the fields a
 * hand-written card most often forgets.
 *
 * A function rather than a static `metadata` export since UX-027
 * (plan-i18n-ptbr.md Phase 1, task 5): the static form is evaluated without a
 * request and so cannot know which language this render is in. `og:locale` now
 * names the ACTIVE locale with the other in `alternates.languages`, which is
 * how D2 keeps multi-language discoverability without a `[locale]` URL
 * segment — the locale belongs to the reader, not to the link, so both
 * languages point at the same canonical URL.
 *
 * `SITE_NAME` stays a constant and is interpolated (UX-021: the product is
 * "SL" in every language, never expanded, never translated).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("metadata");
  const title = t("titleDefault", { siteName: SITE_NAME });

  return {
    metadataBase: siteUrl(),
    title: {
      default: title,
      template: `%s — ${SITE_NAME}`,
    },
    description: t("description", { siteName: SITE_NAME }),
    applicationName: SITE_NAME,
    alternates: {
      canonical: "/",
      // Every locale resolves to the same URL on purpose (D2). This is the
      // honest declaration of that: the page is available in both languages,
      // negotiated per reader, at one address.
      languages: Object.fromEntries(LOCALES.map((l) => [l, "/"])),
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALES[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map(
        (l) => OG_LOCALES[l],
      ),
      title,
      description: t("tagline"),
      url: "/",
    },
    twitter: {
      card: "summary",
      title,
      description: t("tagline"),
    },
  };
}

/**
 * Reading the session here (roadmap Phase 4) is what lets the first client
 * render already know who the visitor is — no logged-out flash, no hydration
 * mismatch (UX-011). It also makes every route dynamic, which is correct:
 * every page in this app is per-user by definition.
 *
 * The feature flags (Phase 9, ARC-016) ride that same already-dynamic request,
 * and all three reads are awaited together — they are independent, and
 * serialising them would put extra round trips in front of every render.
 *
 * The flags read goes through `loadRequestFeatureFlags` since UX-027 rather
 * than being handed this function's `supabase`: `i18n/request.ts` needs the
 * same answer EARLIER in the same request (D13's kill switch decides whether
 * pt-BR is negotiable at all), and by the time this line runs the cached
 * promise is already resolved. The query count is unchanged — still one
 * SELECT against `feature_flags` per page load — the client object is simply
 * created by whichever of the two callers arrives first.
 *
 * `locale` comes from next-intl, which negotiated it in `i18n/request.ts`
 * before any of this ran. Reading it here rather than re-deriving it is what
 * guarantees the exit criterion that `<html lang>` matches the language the
 * page is actually rendered in.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const [initialUser, flags, locale] = await Promise.all([
    getSessionUser(supabase),
    loadRequestFeatureFlags(),
    getLocale(),
  ]);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppProviders
          initialUser={initialUser}
          flags={flags}
          locale={locale}
          messages={messagesFor(locale)}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}

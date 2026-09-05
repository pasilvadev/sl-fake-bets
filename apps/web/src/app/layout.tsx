import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { loadFeatureFlags } from "@/lib/data/feature-flags";
import { SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";
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
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: `${SITE_NAME} — fake-coin bets with your friends`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "SL is a private, free, fake-coin betting app for a group of friends. " +
    "Create a team, post a bet on anything, and settle it pari-mutuel — " +
    "no real money, ever.",
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: `${SITE_NAME} — fake-coin bets with your friends`,
    description: SITE_TAGLINE,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — fake-coin bets with your friends`,
    description: SITE_TAGLINE,
  },
};

/**
 * Reading the session here (roadmap Phase 4) is what lets the first client
 * render already know who the visitor is — no logged-out flash, no hydration
 * mismatch (UX-011). It also makes every route dynamic, which is correct:
 * every page in this app is per-user by definition.
 *
 * The feature flags (Phase 9, ARC-016) ride that same already-dynamic request.
 * Both reads go through one `createClient()` so a page load costs one Supabase
 * client, not two, and both are awaited together — they are independent, and
 * serialising them would put a second round trip in front of every render.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const [initialUser, flags] = await Promise.all([
    getSessionUser(supabase),
    loadFeatureFlags(supabase),
  ]);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppProviders initialUser={initialUser} flags={flags}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}

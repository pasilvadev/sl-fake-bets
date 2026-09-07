/**
 * The app's own absolute origin (roadmap Phase 9, tasks 3 and 4).
 *
 * Social crawlers and `robots`/`sitemap` need absolute URLs — a relative
 * `og:image` or `og:url` is simply dropped by most of them — and Next builds
 * those from `metadata.metadataBase`. Locally that is the dev server; on the
 * future hosted deploy (ARC-012) it is whatever `NEXT_PUBLIC_SITE_URL` says,
 * with Vercel's own `VERCEL_PROJECT_PRODUCTION_URL` as the fallback that needs
 * no configuration at all.
 *
 * A constant rather than a per-request `headers()` read: the value belongs to
 * the deployment, not to the request, and reading it from a `Host` header
 * would let a forged header rewrite the canonical URLs in a shared cache.
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);

  return new URL("http://localhost:3000");
}

/** UX-020/021: the product is "SL". Never "Soulless", anywhere a user can read. */
export const SITE_NAME = "SL";

export const SITE_TAGLINE = "Make stupid fake bets on stupid things";

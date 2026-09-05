import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Crawl policy (UX-017 — roadmap Phase 9, task 4).
 *
 * UX-017's growth path is "google an app for internal bets", so the landing
 * page must be crawlable. Everything behind it must not be: `/join/[code]`
 * carries a live, non-expiring invite code (UX-005) and `/bet/[id]` carries
 * another team's private, deliberately unmoderated content (DOM-030). Both
 * still render social cards — a card is shown to whoever was handed the link,
 * which is a different thing from being indexed — and both also send
 * `noindex` in their own metadata, because a rule here only asks a well-behaved
 * crawler not to FETCH, while the page's own header is what stops one that
 * followed a link anyway.
 *
 * `/auth/` is the OAuth callback: a route handler with a one-time code in its
 * query string, never a destination.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/join/", "/bet/", "/auth/"],
    },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}

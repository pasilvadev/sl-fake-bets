import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Two entries, and that is the correct length (UX-017 — roadmap Phase 9, task
 * 4; `/privacy` added by plan-hosted-early-access.md Phase 1 task 8).
 *
 * Every OTHER route in this app is either per-user (the dashboard behind auth)
 * or holds a secret in its own URL (an invite code, a bet id). Enumerating
 * those would publish exactly what `robots.ts` refuses to let a crawler fetch.
 * The landing page and the privacy page are the only two that are genuinely
 * public with nothing to leak — the same test `robots.ts`'s `allow: "/"`
 * default already applies to both.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl().toString(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: new URL("/privacy", siteUrl()).toString(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}

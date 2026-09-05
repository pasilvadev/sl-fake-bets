import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * The sitemap is one entry long, and that is the correct length (UX-017 —
 * roadmap Phase 9, task 4).
 *
 * Every other route in this app is either per-user (the dashboard behind auth)
 * or holds a secret in its own URL (an invite code, a bet id). Enumerating
 * those would publish exactly what `robots.ts` refuses to let a crawler fetch.
 * So: the landing page, which is the only page that is genuinely public.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl().toString(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}

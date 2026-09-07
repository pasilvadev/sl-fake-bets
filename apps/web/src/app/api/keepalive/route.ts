import { NextResponse, type NextRequest } from "next/server";
import { smokeTest } from "@/lib/supabase/server";

/**
 * Daily keep-alive (plan-hosted-early-access.md D4) — the one thing standing
 * between the production Supabase project and its 7-day idle pause (§2.3).
 * Vercel's cron (`apps/web/vercel.json`) hits this once a day; the route runs
 * a REAL query rather than just answering 200, because a pause is measured in
 * database activity, not in HTTP traffic to some other service.
 *
 * `smokeTest()` reads `feature_flags` — the one table `anon` may SELECT
 * (`lib/supabase/server.ts`'s own comment explains why) — so a 200 here proves
 * the URL/key, PostgREST, and RLS all still work, not just that this route
 * exists.
 *
 * Bearer-gated on Vercel's own `CRON_SECRET` (a platform-generated env var
 * once a `vercel.json` cron is configured, mirrored into `.env.ops` per D10)
 * so this cannot become a free, unauthenticated "is the DB up" probe for
 * anyone who finds the URL. `!expected` refusing outright (rather than
 * comparing against `undefined`) means an environment that never got
 * `CRON_SECRET` configured fails closed instead of accepting a bare
 * `Authorization: Bearer undefined`.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await smokeTest();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

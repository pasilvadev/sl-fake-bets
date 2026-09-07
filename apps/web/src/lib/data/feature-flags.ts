import { cache } from "react";
import type { KnownFeatureFlag } from "@repo/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Feature flags, read at load (ARC-016 — roadmap Phase 9, task 2).
 *
 * The entire mechanism is one SELECT against `public.feature_flags`
 * (20260905120100_infra_tables.sql). There is no admin UI and there must not be
 * one: `design-stack.md` §3 makes flipping a row in Supabase Studio the whole
 * control plane, which is what "toggleable without a deploy or rebuild" means
 * here. The table's RLS grants SELECT to `anon` too, so a logged-out page can
 * read flags — which is why this is also the one query Phase 3's smoke test
 * could use to prove the stack was reachable.
 *
 * Read on the SERVER, in the root layout, and handed down (see
 * `lib/feature-flags.tsx`). Two reasons: every route is already dynamic because
 * the layout reads the session, so the flags ride a request that was happening
 * anyway; and a client-side read would flash the default state before the real
 * one arrives — a toggle you can watch flip on load is worse than no toggle.
 *
 * No per-user targeting and no percentage rollouts. `design-stack.md` §3 rules
 * both out until a feature actually needs one, and none does.
 */

export interface FlagState {
  enabled: boolean;
  /** Optional config carried alongside the toggle. `{}` when unused. */
  payload: Record<string, unknown>;
}

/**
 * Keys the app may ask about. `Partial` because the source of truth is the
 * table, not this type: a key deleted in Studio simply stops appearing, and
 * `useFeatureFlag` treats "absent" as "off".
 */
export type FlagMap = Partial<Record<KnownFeatureFlag, FlagState>>;

interface FlagRow {
  key: string;
  enabled: boolean;
  payload: Record<string, unknown> | null;
}

/**
 * Every flag, as a lookup. Never throws: a flags read that fails must not take
 * the page with it, and "no flags" degrades to every feature off — the safe
 * direction, since a flag guards something that is not finished.
 */
export async function loadFeatureFlags(
  supabase: SupabaseClient,
): Promise<FlagMap> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("key, enabled, payload");

  if (error || !data) {
    if (error) console.error("[feature-flags] read failed:", error.message);
    return {};
  }

  return Object.fromEntries(
    (data as FlagRow[]).map((row) => [
      row.key,
      { enabled: row.enabled, payload: row.payload ?? {} },
    ]),
  ) as FlagMap;
}

/**
 * The same read, deduped for the lifetime of one request
 * (plan-i18n-ptbr.md §5 Phase 1, task 3).
 *
 * Localization is the reason this exists. `i18n/request.ts` has to know
 * whether `locale-pt-br` is on **before** the layout runs — the locale is
 * chosen while next-intl builds the request config, which is upstream of any
 * component — and D13 makes that flag the kill switch for the whole feature.
 * React's `cache()` makes the second caller free: whichever of the two asks
 * first pays for the SELECT, the other gets the same promise.
 *
 * This is the one place a flag read is allowed to precede the layout's. Every
 * other consumer reads the frozen `FlagMap` handed down through
 * `FeatureFlagProvider`, and must keep doing so — a component reaching for
 * this helper would be re-introducing the mid-tree flag read
 * `lib/feature-flags.tsx` exists to prevent.
 */
export const loadRequestFeatureFlags = cache(async (): Promise<FlagMap> => {
  return loadFeatureFlags(await createClient());
});

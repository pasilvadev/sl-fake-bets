/**
 * Infrastructure tables — analytics (ARC-017) and feature flags (ARC-016).
 *
 * Kept out of types.ts on purpose: that file is the DOMAIN model derived from
 * the vision, and neither of these is a domain object. They live here so the
 * shapes in supabase/migrations have exactly one TypeScript counterpart, which
 * is what stops Phase 9 from inventing a second, drifting definition.
 */

/**
 * ARC-017 caps observability at two metrics: onboarding per-step drop-off
 * (UX-028) and invite→signup conversion. Build nothing broader.
 */
export interface AnalyticsEvent {
  id: number;
  eventName: string;
  /**
   * Set before an account exists. The invite→signup half of ARC-017 is only
   * measurable because this survives the signup boundary and stitches the
   * pre- and post-account halves of one funnel together.
   */
  anonymousId: string | null;
  userId: string | null;
  properties: Record<string, unknown>;
  createdAt: string;
}

/** ARC-016: toggled in Studio, read by the app at load. No deploy, no rebuild. */
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  /** Optional config carried alongside the toggle. `{}` when unused. */
  payload: Record<string, unknown>;
  description: string;
  updatedAt: string;
}

/**
 * The flags seeded by 20260905120100_infra_tables.sql, one per post-MVP/future
 * feature the spec already names. Typed as a union so a lookup with a typo
 * fails at compile time instead of silently reading `undefined` (which would
 * render as "feature off" and look like correct behavior).
 */
export type KnownFeatureFlag =
  | "coin-donation"       // DOM-023 [post-mvp]
  // UX-019, Extra Phase 1. No longer [future]: this now gates a shipped
  // feature — the real team chat module — and doubles as its kill switch.
  // Flipped `true` by that phase's migration; flipping it back off in Studio
  // hides the module at both breakpoints on next load, which is exactly what
  // ARC-016 promises and Extra Phase 1's exit criteria verifies.
  | "global-team-chat"
  | "crowd-resolution"    // DOM-020 [future]
  | "platform-icon-set"   // DOM-010 [future]
  // UX-027. Like `global-team-chat` above, this one has stopped being
  // [future]: it now gates a SHIPPED feature — pt-BR itself — and is that
  // feature's kill switch (plan-i18n-ptbr.md D13). Off means `pt-BR` is not in
  // the negotiable set, the switcher does not render, and the app is the
  // English-only one UX-026 shipped. Nothing is stranded by flipping it back:
  // unlike `duel-bets`, no money moves through this flag.
  | "locale-pt-br"
  // `global-team-chat` above and `coming-soon-teasers` below both have live
  // `useFeatureFlag` calls today (pulse-rail.tsx + module-chip-strip.tsx, and
  // wallet-module.tsx respectively), and `duel-bets` at the end of this union
  // is the THIRD — its readers arrive one phase later, with Extra Phase 3's
  // surfaces. So this block long ago stopped being the single-example one it
  // was written as. While correcting that count (Extra Phase 2, task 15) it
  // also has to correct what the FIRST correction got wrong about the history,
  // because a comment that is merely out of date is a nuisance and one that is
  // confidently false is a trap.
  //
  // What actually happened, verified against the pre-Extra-Phase-1 tree rather
  // than remembered:
  //
  //   - `global-team-chat` gated NOTHING before Extra Phase 1. It was a bare
  //     union member with zero `useFeatureFlag` calls anywhere in the app and
  //     a `false` seed (20260905120100_infra_tables.sql, `[future]`). Extra
  //     Phase 1 gave it its first reader and flipped it true. It did not
  //     "move" from the stub to the real module; it was never wired to the
  //     stub at all.
  //
  //   - `chat-stub-module.tsx` was gated by `coming-soon-teasers` ALONE, from
  //     `pulse-rail.tsx` and `module-chip-strip.tsx`. The stub itself imported
  //     no flag hook whatsoever: its `SOON` badge was a hard-coded <span>, not
  //     a flag-driven affordance.
  //
  // The earlier claim here — that `global-team-chat` used to gate the stub,
  // and that "the stub carried both flags at once, `SOON` painted by one and
  // its very existence gated by the other" — was false in both halves. The
  // paragraphs below are untouched by the correction and remain exactly right:
  // precisely ONE flag ever gated the stub, which is why deleting the stub
  // would have orphaned that one.
  //
  // Deleting the stub without re-pointing `coming-soon-teasers` would have
  // silently ended ARC-016's live-toggle proof (roadmap Phase 9, task 2 —
  // seeded by 20260905200000_share_previews.sql, default ON): the flag would
  // still exist and still read `true`, but nothing on screen would move when
  // it changed, and that regression fails silent — no error, no test red,
  // just a guarantee nobody is demonstrating any more. Two ways to avoid that
  // were on the table and both were rejected: deleting the flag ends the
  // proof outright rather than preserving it, and leaving it wired to the
  // now-deleted chat stub is a lie on screen — a toggle with no listener.
  //
  // So `coming-soon-teasers` was RE-POINTED by Extra Phase 1, from the deleted chat
  // stub to the Wallet module's disabled "Donate coins" button (DOM-023's
  // future-stub, still excluded as a feature — see Extra Phase 1's own
  // exclusion list). That button now paints its "SOON" affordance off this
  // flag, so ARC-016's toggle proof keeps a live, visible subject instead of
  // quietly losing one.
  | "coming-soon-teasers"
  // Extra Phase 2 (1v1 duel bets), and the third flag with a live reader.
  // Seeded `true` by 20260906130000_duel_schema.sql, and that seed is an
  // INSERT ... on conflict (key) do update rather than the bare UPDATE the
  // chat migration used, for a reason worth stating once: `global-team-chat`
  // already existed as a row from 20260905120100_infra_tables.sql, so an
  // UPDATE found it. This key does not exist yet, and an UPDATE would have
  // matched zero rows and failed silently — the flag would then read absent,
  // `useFeatureFlag` treats absent as OFF, and the feature would simply never
  // appear with nothing anywhere reporting why.
  //
  // It ships one phase AHEAD of what it gates: Extra Phase 2 is domain, schema
  // and write paths with no new pixels, and the `useFeatureFlag` calls land
  // with Extra Phase 3's compose form, duel row and resolve control. That
  // ordering is deliberate — the kill switch exists before the thing it kills,
  // so whoever first needs duels gone does not need a migration to do it.
  //
  // What it hides is the UI, and only the UI. It does not disarm the RPCs and
  // must never be made to: flipping it off with duels in flight cannot be
  // allowed to strand coins, so `app.expire_stale_duels`, `app.void_duel` and
  // the kick/ban cascade go on refunding underneath a hidden surface. A flag
  // that can lose someone's money is not a kill switch, it is a bug.
  | "duel-bets";

/**
 * The two funnel events ARC-017 permits, and the only two `event_name` values
 * the app ever writes (roadmap Phase 9, task 1).
 *
 * Named here rather than in the web app because the SQL in
 * `supabase/queries/arc-017-metrics.sql` matches on these literals: the query
 * and the writer must agree, and a shared constant is the only version of that
 * agreement a rename cannot silently break.
 *
 * **Do not add a third.** ARC-017 caps observability at exactly two metrics,
 * and this union is where that cap is enforced in code rather than in prose.
 */
export const ANALYTICS_EVENTS = {
  /**
   * Metric 1, onboarding per-step drop-off (UX-028). One row per step reached,
   * `properties.step` naming it — see `components/onboarding/steps.ts` for the
   * four steps and where each is marked.
   */
  onboardingStep: "onboarding_step",
  /**
   * Metric 2's numerator input: an invite link was opened.
   * `properties.code` / `properties.team_id`, written by `/join/[code]`
   * BEFORE any account exists, which is why `anonymous_id` carries it.
   */
  inviteOpened: "invite_opened",
  /** Metric 2's conversion: the account that anonymous id became. */
  signupCompleted: "signup_completed",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

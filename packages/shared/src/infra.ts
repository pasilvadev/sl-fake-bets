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
  | "global-team-chat"    // UX-019  [future]
  | "crowd-resolution"    // DOM-020 [future]
  | "platform-icon-set"   // DOM-010 [future]
  | "locale-pt-br"        // UX-027  [future]
  // The one flag with a live reader (roadmap Phase 9, task 2 — seeded by
  // 20260905200000_share_previews.sql, default ON). Every other key above gates
  // a feature that does not exist yet, so none of them can demonstrate that
  // toggling a row in Studio actually changes the app — and building one to
  // demonstrate it is precisely the scope creep Phase 9 is guarded against.
  // This gates something already built: the "SOON" teaser modules.
  | "coming-soon-teasers";

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

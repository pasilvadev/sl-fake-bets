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
  | "coin-donation"      // DOM-023 [post-mvp]
  | "global-team-chat"   // UX-019  [future]
  | "crowd-resolution"   // DOM-020 [future]
  | "platform-icon-set"  // DOM-010 [future]
  | "locale-pt-br";      // UX-027  [future]

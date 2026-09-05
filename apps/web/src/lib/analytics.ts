"use client";

import { ANALYTICS_EVENTS, type AnalyticsEventName } from "@repo/shared";
import { createClient } from "@/lib/supabase/client";

/**
 * In-house analytics (ARC-016/017 — roadmap Phase 9, task 1).
 *
 * There is no vendor here and there will not be one: `design-stack.md` §3 is
 * the owner's amendment that killed PostHog, and the whole mechanism is an
 * INSERT into `public.analytics_events` (20260905120100_infra_tables.sql). The
 * two mandated metrics are then plain SQL in Studio —
 * `supabase/queries/arc-017-metrics.sql` holds both queries.
 *
 * ARC-017 caps observability at EXACTLY two metrics: onboarding per-step
 * drop-off (UX-028) and invite-open → signup conversion. `ANALYTICS_EVENTS` in
 * packages/shared is the closed list that enforces the cap, and `track` below
 * accepts nothing else. A pageview tracker, a click tracker, an error reporter
 * or a "just one more event" all fail that requirement — the number two is the
 * requirement, not a starting point.
 *
 * Three properties this module has to hold, in order of how easily each is
 * lost:
 *
 *   1. **It never affects what the user sees.** Every write is fire-and-forget
 *      and every failure is swallowed. Analytics that can break a signup is a
 *      worse trade than analytics that occasionally loses a row.
 *   2. **It works before an account exists.** Metric 2 starts on an invite link
 *      opened by someone who has never signed in, so the row carries an
 *      `anonymous_id` from localStorage — which is exactly what stitches the
 *      pre- and post-signup halves of that funnel together, and why the RLS
 *      policy grants INSERT to `anon`.
 *   3. **Duplicates are harmless, not prevented.** Effects re-run (React
 *      StrictMode double-invokes them in dev), pages reload, users open two
 *      tabs. The in-session guard below removes the cheap duplicates; the SQL
 *      counts DISTINCT actors, which removes the rest. Anything stronger would
 *      mean a read-before-write on every step.
 */

/** Per-browser id that survives the signup boundary. Not a fingerprint. */
const ANON_ID_KEY = "sl:anon-id";

/**
 * Suppresses re-fires within one page session (a remount, a StrictMode double
 * effect, a re-render). Deliberately NOT persisted: the SQL is written to
 * tolerate what this misses, and a persisted guard would silently drop the
 * second half of a funnel for anyone who cleared it.
 */
const firedThisSession = new Set<string>();

/**
 * One client for every event this tab writes. `createClient` is cheap, but it
 * is not free — each call builds a fresh auth surface — and analytics is the
 * one caller that fires from many unrelated components.
 */
let client: ReturnType<typeof createClient> | null = null;
function analyticsClient() {
  client ??= createClient();
  return client;
}

export function getAnonymousId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(ANON_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage disabled. An event with only a user_id still
    // measures metric 1; metric 2's anonymous half is what is lost, and losing
    // it is better than throwing inside a render path.
    return null;
  }
}

interface TrackOptions {
  /** The signed-in account, when there is one. RLS rejects any other id. */
  userId?: string | null;
  /**
   * Collapses repeat fires within this page session. Include whatever makes
   * the event distinct (the step name, the invite code) — omit it only for an
   * event that genuinely should be written every time it happens.
   */
  dedupeKey?: string;
}

export function track(
  event: AnalyticsEventName,
  properties: Record<string, unknown> = {},
  { userId = null, dedupeKey }: TrackOptions = {},
): void {
  if (typeof window === "undefined") return;

  if (dedupeKey !== undefined) {
    const key = `${event}:${dedupeKey}`;
    if (firedThisSession.has(key)) return;
    firedThisSession.add(key);
  }

  const anonymousId = getAnonymousId();
  // The table's CHECK requires at least one identifier. With storage blocked
  // and nobody signed in there is no row to write that would mean anything.
  if (!anonymousId && !userId) return;

  void analyticsClient()
    .from("analytics_events")
    .insert({
      event_name: event,
      anonymous_id: anonymousId,
      user_id: userId,
      properties,
    })
    .then(({ error }) => {
      // Never surfaced. See property 1 above.
      if (error) console.debug("[analytics] dropped:", event, error.message);
    });
}

/** Metric 1 (UX-028). Fired from `components/onboarding/steps.ts`. */
export function trackOnboardingStep(step: string, userId: string | null): void {
  track(
    ANALYTICS_EVENTS.onboardingStep,
    { step },
    { userId, dedupeKey: `${step}:${userId ?? "anon"}` },
  );
}

/** Metric 2, first half. Fired by `/join/[code]`, signed in or not. */
export function trackInviteOpened(
  code: string,
  teamId: string | null,
  userId: string | null,
): void {
  track(
    ANALYTICS_EVENTS.inviteOpened,
    { code, team_id: teamId },
    { userId, dedupeKey: code },
  );
}

/**
 * Metric 2, conversion. Fired once the world has loaded for an account whose
 * `onboarded_at` is still NULL — i.e. an account in its first run, which is
 * the only durable "this identity is new" signal the client has (see
 * `team-context.tsx`, where it is called).
 */
export function trackSignupCompleted(userId: string): void {
  track(ANALYTICS_EVENTS.signupCompleted, {}, { userId, dedupeKey: userId });
}

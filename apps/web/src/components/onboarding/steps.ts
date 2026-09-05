"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { trackOnboardingStep } from "@/lib/analytics";

/**
 * Onboarding as discrete, named steps (UX-028) — roadmap Phase 7.5, task 7,
 * instrumented by Phase 9, task 1.
 *
 * The order is decision §4.7: an account signs up, gets into a team (created or
 * joined), confirms its profile, and lands on the dashboard. Every one of those
 * is a screen that already exists; what did not exist was anywhere that says so
 * in one place, which made "is onboarding structured as steps?" a question you
 * answered by reading four components and forming an opinion.
 *
 * Phase 9 verified exactly that and then replaced this module's no-op with the
 * `analytics_events` insert it was reserved for — **the call sites did not
 * move**, which was the point of building the seam a phase early. What is
 * measured is *reaching* a step, so drop-off is the difference between two
 * consecutive steps' distinct actors; the `signup` step is necessarily counted
 * against an anonymous id, because no account exists while that screen is up.
 */

export const ONBOARDING_STEPS = ["signup", "team", "profile", "dashboard"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What each step actually is, for whoever reads the funnel's drop-off later. */
export const ONBOARDING_STEP_DESCRIPTIONS: Record<OnboardingStep, string> = {
  signup: "Auth screen: email OTP or Google (auth-page.tsx).",
  team: "No team yet: create one, or spend an invite code (team-gate.tsx).",
  profile: "First-run profile confirmation, skippable (profile-step.tsx).",
  dashboard: "Onboarding complete — the team dashboard (dashboard-page.tsx).",
};

/** The last step this session reached — kept for reading in the console. */
let lastReached: OnboardingStep | null = null;

/**
 * The single seam. Writes one `analytics_events` row per step per identity per
 * page session; `track` swallows every failure, so nothing here can keep a step
 * from rendering.
 */
export function reachOnboardingStep(
  step: OnboardingStep,
  userId: string | null = null,
): void {
  lastReached = step;
  trackOnboardingStep(step, userId);
}

export function lastOnboardingStepReached(): OnboardingStep | null {
  return lastReached;
}

/** Mark a step reached for as long as its screen is mounted. */
export function useOnboardingStep(step: OnboardingStep): void {
  // The auth identity, not the UX-022 profile: on the `signup` step there is
  // no account yet and this is null, which is exactly the case the anonymous
  // id exists for.
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    reachOnboardingStep(step, userId);
  }, [step, userId]);
}

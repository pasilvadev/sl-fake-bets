"use client";

import { useEffect } from "react";

/**
 * Onboarding as discrete, named steps (UX-028) — roadmap Phase 7.5, task 7.
 *
 * The order is decision §4.7: an account signs up, gets into a team (created or
 * joined), confirms its profile, and lands on the dashboard. Every one of those
 * is a screen that already exists; what did not exist was anywhere that says so
 * in one place, which made "is onboarding structured as steps?" a question you
 * answered by reading four components and forming an opinion.
 *
 * **This module writes nothing.** ARC-017's instrumentation is Phase 9 task 1,
 * whose first line is "verify onboarding is structured as discrete steps" —
 * this is the thing that makes that verifiable rather than interpretive, and
 * `reachOnboardingStep` below is the single seam that phase inserts the
 * `analytics_events` insert into. Adding the write here would be Phase 9's work
 * done early and without its ARC-017 scope guard.
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

/**
 * The last step this session reached. Read it in the console while walking the
 * flow; that is its whole job today. Phase 9 replaces the assignment with an
 * `analytics_events` insert and keeps the call sites exactly where they are.
 */
let lastReached: OnboardingStep | null = null;

export function reachOnboardingStep(step: OnboardingStep): void {
  lastReached = step;
}

export function lastOnboardingStepReached(): OnboardingStep | null {
  return lastReached;
}

/** Mark a step reached for as long as its screen is mounted. */
export function useOnboardingStep(step: OnboardingStep): void {
  useEffect(() => {
    reachOnboardingStep(step);
  }, [step]);
}

"use client";

import type { ReactNode } from "react";
import { useTeam } from "@/lib/team-context";
import { ProfileStep } from "@/components/onboarding/profile-step";

/**
 * Roadmap Phase 7.5: the first-run profile step, between the team world and the
 * dashboard (decision §4.7).
 *
 * `onboardedAt === null` is the entire condition — the column has no default
 * and NULL *is* "first run" — and both ways out of the step stamp it, so this
 * renders at most once per account, ever. Existing accounts were backfilled by
 * the migration and never see it.
 *
 * It sits below TeamGate on purpose: `useTeam()` is only safe there, and the
 * step needs `currentUser` and `completeOnboarding` from it. And it is wired
 * into `AppGate` only — a visitor who followed a shared bet link gets the bet,
 * because `bet-detail-page.tsx` mounts its own AuthGated/TeamGate and not this.
 * They meet the step on their first real dashboard landing instead.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { onboarding } = useTeam();

  return onboarding.onboardedAt === null ? <ProfileStep /> : <>{children}</>;
}

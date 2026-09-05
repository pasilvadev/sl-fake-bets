"use client";

import { WalletModule } from "./wallet-module";
import { StandingsModule } from "./standings-module";
import { TeamModule } from "./team-module";
import { ChatStubModule } from "./chat-stub-module";
import { useFeatureFlag } from "@/lib/feature-flags";

/**
 * Desktop Pulse Rail (design-dashboard.md §4/§1.3): the 4 modules,
 * top→bottom by check-frequency. Hidden below `lg` — see ModuleChipStrip
 * for the 1024px-down replacement.
 *
 * Module 4 is the UX-019 "SOON" teaser, and since roadmap Phase 9 it is the
 * app's one live feature-flag reader (ARC-016). The flag is seeded ON, so the
 * rail renders exactly what §4.4 specifies; flipping `coming-soon-teasers` to
 * false in Supabase Studio drops it on the next load, with no deploy and no
 * rebuild. It gates something that already EXISTS on purpose — demonstrating
 * the toggle by building a post-MVP feature behind it is the scope creep Phase
 * 9 is explicitly guarded against.
 */
export function PulseRail() {
  const showTeasers = useFeatureFlag("coming-soon-teasers");

  return (
    <div className="hidden lg:flex lg:flex-col lg:gap-4">
      <WalletModule />
      <StandingsModule />
      <TeamModule />
      {showTeasers && <ChatStubModule />}
    </div>
  );
}

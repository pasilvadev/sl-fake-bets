"use client";

import { WalletModule } from "./wallet-module";
import { StandingsModule } from "./standings-module";
import { TeamModule } from "./team-module";
import { ChatModule } from "./chat-module";
import { useFeatureFlag } from "@/lib/feature-flags";

/**
 * Desktop Pulse Rail (design-dashboard.md §4/§1.3): the 4 modules,
 * top→bottom by check-frequency. Hidden below `lg` — see ModuleChipStrip
 * for the 1024px-down replacement.
 *
 * **Module 4 is now the real UX-019 team channel (roadmap §8 Extra Phase 1),
 * not the "SOON" teaser it was through Phase 9.** It is gated on
 * `global-team-chat` — seeded `true` by that phase's migration — kept not as
 * a "feature not built yet" gate but as the module's KILL SWITCH: flipping it
 * off in Supabase Studio drops the whole module on the next load, with no
 * deploy and no rebuild, same ARC-016 guarantee Phase 9 first demonstrated
 * here. When the flag is off this renders three modules, not a stub — the
 * stub (`chat-stub-module.tsx`) is gone, and there is nothing to fall back to.
 *
 * **`coming-soon-teasers` no longer has a subject in this file.** Through
 * Phase 9 it gated the same module slot (the chat stub), which is what made
 * this file "the app's one live feature-flag reader." Deleting that reader
 * outright when the stub was deleted would have silently ended Phase 9's
 * ARC-016 proof — the flag would still exist and still read `true`, but
 * nothing on screen would move when it changed. So the flag was RE-POINTED
 * rather than dropped: its live reader is now the Wallet module's disabled
 * "Donate coins" button (DOM-023 future-stub, `wallet-module.tsx`), which is
 * a real, still-excluded future feature the same way the chat stub was
 * before this phase built chat for real. See that file's header and
 * `packages/shared/src/infra.ts`'s `KnownFeatureFlag` comment for the full
 * account of why the flag moved instead of being deleted or left dangling.
 */
export function PulseRail() {
  const showChat = useFeatureFlag("global-team-chat");

  return (
    <div className="hidden lg:flex lg:flex-col lg:gap-4">
      <WalletModule />
      <StandingsModule />
      <TeamModule />
      {/* "modal" (D4): a permanently-docked module with a modal layer free to
          open above it — see chat-module.tsx's header for the full contract
          this prop carries and why `module-chip-strip.tsx`'s bottom sheet
          passes "page" instead. */}
      {showChat && <ChatModule earlierMessagesMode="modal" />}
    </div>
  );
}

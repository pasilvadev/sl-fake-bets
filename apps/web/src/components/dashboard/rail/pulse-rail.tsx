"use client";

import { WalletModule } from "./wallet-module";
import { StandingsModule } from "./standings-module";
import { TeamModule } from "./team-module";
import { ChatStubModule } from "./chat-stub-module";

/**
 * Desktop Pulse Rail (design-dashboard.md §4/§1.3): the 4 modules,
 * top→bottom by check-frequency. Hidden below `lg` — see ModuleChipStrip
 * for the 1024px-down replacement.
 */
export function PulseRail() {
  return (
    <div className="hidden lg:flex lg:flex-col lg:gap-4">
      <WalletModule />
      <StandingsModule />
      <TeamModule />
      <ChatStubModule />
    </div>
  );
}

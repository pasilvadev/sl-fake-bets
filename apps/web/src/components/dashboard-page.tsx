"use client";

import { TopBar } from "@/components/shell/top-bar";
import { Ticker } from "@/components/shell/ticker";
import { ModuleChipStrip } from "@/components/dashboard/rail/module-chip-strip";
import { BetFeed } from "@/components/dashboard/bet-feed";
import { PulseRail } from "@/components/dashboard/rail/pulse-rail";
import { CreateBetFab } from "@/components/shell/create-bet-fab";

/**
 * Dashboard shell (design-dashboard.md §1): top bar + ticker (both full
 * width, outside the max-w body), module chip strip (self-hides ≥lg), then
 * the 2-col body — feed + sticky pulse rail. Providers and the modal mount
 * point live in the root layout (app-providers.tsx).
 */
export function DashboardPage() {
  return (
    <>
      <TopBar />
      <Ticker />
      <ModuleChipStrip />

      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
          <BetFeed />

          <aside className="hidden lg:block">
            <div className="sticky top-[96px] max-h-[calc(100vh-112px)] overflow-y-auto">
              <PulseRail />
            </div>
          </aside>
        </div>
      </div>

      <CreateBetFab />
    </>
  );
}

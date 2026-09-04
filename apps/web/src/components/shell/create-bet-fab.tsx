"use client";

import { Plus } from "lucide-react";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";

/**
 * Mobile Create Bet FAB (design-dashboard.md §6): replaces the top-bar
 * primary CTA below `sm`. Circle sanctioned via the §4.1 icon-button
 * exception.
 */
export function CreateBetFab() {
  const { canCreateBet } = useTeam();
  const { open } = useModal();

  if (!canCreateBet) return null;

  return (
    <button
      type="button"
      onClick={() => open("create-bet")}
      aria-label="Create bet"
      className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-jade text-black transition-[filter] hover:brightness-110 active:brightness-95 sm:hidden"
    >
      <Plus className="size-6" />
    </button>
  );
}

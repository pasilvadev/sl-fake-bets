"use client";

import { Plus, Swords } from "lucide-react";
import { canStartDuel } from "@repo/shared";
import { useTeam } from "@/lib/team-context";
import { useModal } from "@/lib/modal-context";
import { useFeatureFlag } from "@/lib/feature-flags";
import { useTranslations } from "next-intl";

/**
 * The mobile FAB tier (design-dashboard.md §6): below `sm` the top bar's two
 * compose CTAs leave the bar and become fixed buttons bottom-right. Circles
 * are sanctioned here by §4.1's icon-button exception and nowhere else.
 *
 * Extra Phase 3 turned this from one button into a stack of two, and three
 * things about that are deliberate:
 *
 *  - **Each button is its own element with its own gate**, not two children of
 *    one guard. The old file early-returned `null` on `!canCreateBet`; hanging
 *    the duel FAB inside that would have re-gated duels on DOM-002. D9 says
 *    the access mode rations posted bets and NOT duels, so in a `restricted`
 *    team an ordinary member gets the 1v1 FAB and no Create Bet FAB. The
 *    asymmetry is the ruling — do not "fix" it by unifying the guards.
 *  - **The wrapper owns the position, the buttons own only themselves.** Two
 *    independently `fixed` elements would each need to know the other's height
 *    to stack, which is the same number `--fab-stack-height` exists to keep in
 *    one place; a bottom-anchored column needs neither to know.
 *  - **`--fab-stack-height` was bumped in `globals.css` and nowhere else.**
 *    It is what keeps the mobile toast strip off this tier
 *    (`sl/toast-layer.tsx` is its only consumer) and it now describes the
 *    stack at its TALLEST — both FABs present. When only one renders the strip
 *    clears more air than it strictly needs, which is the safe direction: the
 *    alternative is a toast landing on a button.
 *
 * §5.3 caps the screen at one jade-filled primary, so Create Bet keeps the
 * jade fill and Start 1v1 is the outline variant — and smaller, which is also
 * what puts the primary nearest the thumb.
 */
export function CreateBetFab() {
  const { team, currentUser, canCreateBet } = useTeam();
  const { open } = useModal();
  const t = useTranslations("createBetFab");
  const mayStartDuel =
    useFeatureFlag("duel-bets") && canStartDuel(team, currentUser.id);

  if (!canCreateBet && !mayStartDuel) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:hidden">
      {mayStartDuel && (
        <button
          type="button"
          onClick={() => open("start-duel")}
          aria-label={t("startDuel")}
          className="flex size-11 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground transition-colors hover:border-jade/50 hover:text-jade"
        >
          <Swords className="size-5" />
        </button>
      )}

      {canCreateBet && (
        <button
          type="button"
          onClick={() => open("create-bet")}
          aria-label={t("createBet")}
          className="flex size-14 items-center justify-center rounded-full bg-jade text-black transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95"
        >
          <Plus className="size-6" />
        </button>
      )}
    </div>
  );
}

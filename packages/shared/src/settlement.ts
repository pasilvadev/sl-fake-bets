import type { Bet, BetResolution, Duel, Wager } from "./types";

/**
 * Pari-mutuel settlement (DOM-016/018/019) — the single module the Phase-2
 * kick/ban cascade and the Phase-7 resolveBet RPC both call unchanged.
 *
 * Money model (decision §4.6): a stake leaves TeamMember.coinBalance the
 * moment the wager is placed, so settlement only emits CREDITS — winner
 * payouts or void refunds — plus the realized profit/loss contribution
 * (DOM-026). It never emits Transaction rows: resolution is not a ledger
 * event (DOM-025).
 */

export interface SettlementDelta {
  userId: string;
  /** Credit to the member's coinBalance (the stake already left at placement). */
  balanceDelta: number;
  /** Realized P/L contribution: payout − stake on a winner; 0 on void/refund. */
  profitLossDelta: number;
}

/**
 * Given a bet, the live wagers, and the declared resolution, compute the
 * per-member deltas. Winner payout = the member's stake on the winning
 * option × pool multiplier, floored once per member (integer math first, so
 * no float drift; no rake per A-3). Void fully refunds every stake
 * (DOM-019). A "winner" nobody backed also refunds — with an empty winning
 * side there is no one to redistribute the pool to.
 */
export function settleBet(
  bet: Bet,
  wagers: readonly Wager[],
  resolution: BetResolution,
): SettlementDelta[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);

  const stakeByUser = new Map<string, number>();
  for (const w of betWagers) {
    stakeByUser.set(w.userId, (stakeByUser.get(w.userId) ?? 0) + w.amount);
  }

  const winTotal =
    resolution.kind === "winner"
      ? betWagers
          .filter((w) => w.optionId === resolution.winningOptionId)
          .reduce((sum, w) => sum + w.amount, 0)
      : 0;

  if (resolution.kind === "void" || winTotal === 0) {
    return [...stakeByUser.entries()].map(([userId, stake]) => ({
      userId,
      balanceDelta: stake,
      profitLossDelta: 0,
    }));
  }

  const pool = betWagers.reduce((sum, w) => sum + w.amount, 0);

  return [...stakeByUser.entries()].map(([userId, stake]) => {
    const winStake = betWagers
      .filter(
        (w) => w.userId === userId && w.optionId === resolution.winningOptionId,
      )
      .reduce((sum, w) => sum + w.amount, 0);
    const payout = winStake === 0 ? 0 : Math.floor((winStake * pool) / winTotal);
    return { userId, balanceDelta: payout, profitLossDelta: payout - stake };
  });
}

/**
 * True when `settleBet` will take its refund branch for this resolution: a
 * declared void, or a "winner" nobody actually backed (line 49 above) — both
 * return `profitLossDelta: 0` for every participant, but neither is a genuine
 * push (a real payout that happens to net to exactly the stake back). Callers
 * that need to tell "refunded" from "broke even" apart — the history screen's
 * wording is the first one — must check this instead of `resolution.kind`
 * alone, or a "winner" with an empty winning side reads as a push.
 */
export function isRefundResolution(
  bet: Bet,
  wagers: readonly Wager[],
  resolution: BetResolution,
): boolean {
  if (resolution.kind === "void") return true;
  const winTotal = wagers
    .filter(
      (w) => w.betId === bet.id && w.optionId === resolution.winningOptionId,
    )
    .reduce((sum, w) => sum + w.amount, 0);
  return winTotal === 0;
}

/**
 * Kick/ban wager cascade (DOM-032, decision §4.4): drop the member's wagers
 * from every active (non-resolved) bet — plain removal, no refund, since the
 * per-team balance is deleted with the membership. Pool odds recompute
 * automatically wherever getPoolStats runs over the returned list. Wagers on
 * resolved bets stay untouched.
 */
export function removeMemberActiveWagers(
  userId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): Wager[] {
  const resolvedBetIds = new Set(
    bets.filter((b) => b.state === "resolved").map((b) => b.id),
  );
  return wagers.filter(
    (w) => w.userId !== userId || resolvedBetIds.has(w.betId),
  );
}

/**
 * Team-scoped form of the cascade above — what kick/ban and leaveTeam
 * actually need, since a membership only ever ends in ONE team while the
 * wager list spans every team the user plays in (DOM-013 balances are
 * per-team). Scoping first is what keeps a kick from t-01 out of t-02's pools;
 * the removal decision itself stays in `removeMemberActiveWagers`.
 */
export function removeMemberWagersInTeam(
  userId: string,
  teamId: string,
  bets: readonly Bet[],
  wagers: readonly Wager[],
): Wager[] {
  const teamBets = bets.filter((b) => b.teamId === teamId);
  const teamBetIds = new Set(teamBets.map((b) => b.id));
  const teamWagers = wagers.filter((w) => teamBetIds.has(w.betId));
  const keptIds = new Set(
    removeMemberActiveWagers(userId, teamBets, teamWagers).map((w) => w.id),
  );
  // Filtering the original list (rather than concatenating) keeps order stable.
  return wagers.filter((w) => !teamBetIds.has(w.betId) || keptIds.has(w.id));
}

/**
 * The duel-shaped cascade (Extra Phase 2, task 11): which duels must be VOIDED
 * because one of their two participants is leaving the team — kicked, banned,
 * or walking out — returned as bet ids in `bets` order.
 *
 * Why this exists at all, rather than letting `removeMemberWagersInTeam` handle
 * it: that function is pool-shaped, and correctly so. Dropping one bettor from
 * a many-bettor pool leaves a valid pool that simply pays out differently, and
 * DOM-032 says the departing member's stake evaporates with their per-team
 * balance. Drop one of EXACTLY TWO and what is left is not a smaller duel —
 * it is one person's stake with nothing on the other side to settle against, a
 * bet that can never legally resolve and whose surviving participant is out
 * real coins forever. So the duel is voided (`void_reason='participant-left'`)
 * and the survivor refunded, which is `settleBet`'s ordinary void branch doing
 * ordinary work — no new money path (risk 3).
 *
 * A departing MEDIATOR returns nothing, deliberately (D7). Their leaving
 * strands no duel: `app.can_resolve_duel` falls back to the any-moderator pool
 * at READ time, and `bet_duels.mediator_id` going null takes nothing with it,
 * so the duel stays resolvable by any moderator the moment the named one is
 * gone. A runtime fallback, never a stored reassignment — nothing here to fix
 * and nothing to void.
 *
 * **DOCUMENTED DEPARTURE FROM ITS NEIGHBOURS ABOVE, and the reason it takes a
 * whole paragraph: this list is NOT sent to the RPC.** `removeMemberWagersInTeam`
 * hands `remove_membership` a `p_wager_ids` array, and that is safe for the
 * exact reason its header states — the DELETE re-scopes the list to this team
 * and this user, "so the argument can only ever narrow what the cascade already
 * permits." Voiding a duel does not narrow anything: it MOVES MONEY to the
 * surviving participant, and `20260905150000_bet_rpcs.sql`'s header already
 * settles what that means — "a list of BALANCE DELTAS has no such property —
 * narrowing is meaningless and a forged delta is free coins." So the server
 * derives this set itself, in `app.void_duels_for_departing_member`, called
 * from inside `remove_membership` before the wager delete and the membership
 * delete. This function is the client-side twin that patches the local copy
 * after the RPC returns — and the single written statement of the rule, which
 * is why it is spelled out here rather than assumed.
 *
 * Non-resolved only, matching `removeMemberActiveWagers`'s own "wagers on
 * resolved bets stay untouched": a duel that already paid out is history, and
 * refunding it now would both invent coins and break `deriveProfitLoss`, which
 * replays every resolved bet the consistency guard can still see.
 */
export function voidDuelsForDepartingMember(
  userId: string,
  teamId: string,
  bets: readonly Bet[],
  duels: readonly Duel[],
): string[] {
  const duelByBetId = new Map(duels.map((d) => [d.betId, d]));

  // Iterating `bets` rather than `duels` is what fixes the output order to
  // `bets` order — the callers diff this against a local list, and a stable
  // order keeps that diff readable. `bet_duels` is 1:1 with its bet by primary
  // key, so the presence of a duel row IS the "this is a duel" test; `bet.kind`
  // is not consulted, because a bet carrying a duel row and `kind='pool'` is a
  // state the schema cannot produce.
  return bets
    .filter((bet) => {
      if (bet.teamId !== teamId || bet.state === "resolved") return false;
      const duel = duelByBetId.get(bet.id);
      if (duel === undefined) return false;
      return duel.challengerId === userId || duel.challengeeId === userId;
    })
    .map((bet) => bet.id);
}

/**
 * Hard-delete reversal (DOM-033): the deltas that undo a bet's money effects
 * entirely, so deleting it leaves balances and P/L exactly where they were
 * before the first wager. Stakes come back (they left at placement); if the
 * bet was already resolved, its payout and realized P/L are unwound too —
 * otherwise deleted history would silently break `deriveProfitLoss`, which
 * only ever sees the bets that still exist.
 *
 * Deliberately NOT the kick/ban cascade's behavior: there the member's whole
 * per-team balance disappears with the membership, so there is nothing to
 * refund to (decision §4.4). Here every member stays.
 */
export function reverseBet(bet: Bet, wagers: readonly Wager[]): SettlementDelta[] {
  const betWagers = wagers.filter((w) => w.betId === bet.id);

  const stakeByUser = new Map<string, number>();
  for (const w of betWagers) {
    stakeByUser.set(w.userId, (stakeByUser.get(w.userId) ?? 0) + w.amount);
  }

  const settled =
    bet.state === "resolved" && bet.resolution
      ? new Map(
          settleBet(bet, betWagers, bet.resolution).map((d) => [d.userId, d]),
        )
      : new Map<string, SettlementDelta>();

  return [...stakeByUser.entries()].map(([userId, stake]) => {
    const paid = settled.get(userId);
    return {
      userId,
      balanceDelta: stake - (paid?.balanceDelta ?? 0),
      // `0 - x`, not `-x`: negating a plain 0 yields -0, which then travels
      // into stored profitLoss and trips strict equality checks.
      profitLossDelta: 0 - (paid?.profitLossDelta ?? 0),
    };
  });
}

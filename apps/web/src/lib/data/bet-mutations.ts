import { CONFIG, type BetResolution, type BetVoidReason, type SettlementDelta } from "@repo/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fail, unexpected, type MutationResult } from "./result";

/**
 * The bet & wager write layer (roadmap Phase 6, extended in Phase 7).
 *
 * Almost every function here is one call to a SECURITY DEFINER RPC from
 * `20260905150000_bet_rpcs.sql` or `20260905170000_resolution_rewards_ledger.sql`
 * — the bet, option and wager tables accept no direct client write at all, and
 * those files' headers say why for each. A bet is never one row, and anything
 * touching a wager moves money.
 *
 * `addComment` is the single exception, for the reason team-mutations.ts keeps
 * a plain-table-write half: one row, no money, and a policy that already states
 * the whole rule.
 *
 * The RPCs return the values the client cannot predict — database-generated
 * ids, the server's clock, the deltas a delete actually applied — so
 * team-context can patch its local copy with what Postgres did rather than
 * re-guessing it. Failures come back as MutationResult, carrying the RPC's own
 * sentence: it deliberately raises the exact message `validation.ts` and
 * `permissions.ts` produce, so a server rejection reads like a client one.
 *
 * Extra Phase 2 (1v1 duels) adds `startDuel` / `acceptDuel` / `declineDuel`
 * here rather than in a `duel-mutations.ts` of their own, and that is a
 * decision, not laziness. A duel IS a bet (owner decision D1: a `bets` row
 * with `kind='duel'` plus a `bet_duels` side row), it is resolved by the same
 * `resolve_bet` every pool bet is resolved by, deleted by the same
 * `delete_bet`, and settled by the same `app.settle_bet`. Splitting its write
 * path into a parallel module would put the two halves of one lifecycle in two
 * files and make it that much easier for someone to write the second
 * settlement path §6 of the implementation contract exists to forbid.
 *
 * The one thing duels do bring that nothing else in this file has is a pair of
 * failures that are NOT sentences raised by an RPC: task 9's anti-spam trigger
 * raises named SQLSTATEs instead, and `asDuelFailure` below turns those into
 * the app's own prose. See that function for why the trigger does it that way.
 */

type Client = SupabaseClient;

function asFailure(error: PostgrestError): MutationResult {
  return unexpected(error);
}

// --- duel anti-spam codes (Extra Phase 2 task 9) --------------------------------
// `20260906130100_duel_rpcs.sql`'s anti-spam trigger raises these as SQLSTATEs
// rather than as message text this file pattern-matches, for the reason
// Extra Phase 1's flood control already established next door in `chat.ts`: a
// user-definable SQLSTATE is a NAME, and keying on the name rather than on the
// sentence is what lets the migration reword its `raise` tomorrow without
// silently breaking the toast mapped to it today. Keying on `error.message`
// would tie this file's behaviour to prose living in another file in another
// language, with nothing — not the compiler, not a test — able to notice the
// two drifting apart.
//
// Worth saying once, in the same place the trigger's own migration says it:
// this is RATE CONTROL, NOT MODERATION. It bounds how many challenges one
// person may have in flight and says nothing whatever about who they are or
// what they wrote, so DOM-030 (nobody's message or comment is ever deleted or
// hidden on someone else's behalf) is untouched by it.

/** A challenger already holds CONFIG.DUEL_MAX_PENDING_PER_CHALLENGER
 * unanswered challenges in this team (the trigger's counting half). */
export const DUEL_PENDING_CAP_SQLSTATE = "SLD01";

/** A second still-unanswered challenge from this challenger to this same
 * challengee (the trigger's pair half). */
export const DUEL_DUPLICATE_PAIR_SQLSTATE = "SLD02";

/**
 * Postgres's own unique-violation code, mapped here to the SAME sentence as
 * SLD02.
 *
 * HISTORY, because this arm now guards a race that no longer exists and
 * deleting it would erase why it was ever right. The duplicate-pair rule
 * originally leaned on `bet_duels_one_pending_per_pair_idx`, a partial unique
 * index, because a BEFORE INSERT trigger answers "does a pending duel between
 * these two already exist?" with a SELECT, and two concurrent `create_duel`
 * transactions could both get "no" before either had inserted. The loser of
 * that race came back as a bare 23505 naming an index, which is not feedback,
 * so it was mapped to SLD02's sentence.
 *
 * That index was DROPPED by `20260906130400_duel_pair_rule_fix.sql`, and for a
 * defect rather than a preference: its predicate was `where accepted_at is
 * null`, which never stops matching a declined or expired duel — nothing ever
 * stamps `accepted_at` on one — so a single decline locked that pair out of
 * each other permanently. The correct predicate needs `bets.state`, which a
 * partial index cannot reach, so the race is now closed by the `team_members`
 * FOR UPDATE lock `create_duel` already takes, moved above the two checks it
 * now also protects. That migration's header carries the full argument.
 *
 * This arm is KEPT anyway, deliberately. It costs one comparison, it is still
 * the correct sentence for the situation, and the alternative is a client that
 * shows a raw Postgres error the day someone adds a unique constraint to one
 * of these tables. It is a fallback now, not the load-bearing half.
 */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

/**
 * One PostgrestError from `create_duel`, turned into the sentence a toast can
 * show.
 *
 * Only `startDuel` uses this. `acceptDuel` and `declineDuel` stay on plain
 * `asFailure` because the anti-spam trigger fires on `bet_duels` INSERT only,
 * so its codes cannot reach them, and every other way those two calls can fail
 * is already an RPC `raise` carrying the app's own wording verbatim.
 *
 * There is deliberately no `23514` (CHECK violation) arm, which is the one
 * visible difference from `chat.ts`'s otherwise identical mapper, and the
 * asymmetry has a cause: `sendChatMessage` is a PLAIN INSERT, so the table's
 * `body` CHECK is a failure mode a member can actually reach and needs a
 * sentence for. Every duel write goes through an RPC that re-checks every
 * `validateDuelDraft` rule first and raises this repo's own message for each,
 * so `bet_duels`'s CHECKs (`stake >= 1`, distinct participants, mediator not a
 * participant, a resolver exists) are unreachable from a client — reaching one
 * would mean the RPC's validation and the table's constraints disagree, which
 * is a bug to fix in SQL, not a case to paper over with a friendly toast here.
 * Falling through to `error.message` surfaces it loudly, which is what we want.
 *
 * Everything unrecognised falls through to the raw `error.message` for the
 * same reason chat's mapper does: a message this module has no better sentence
 * for is still better shown than swallowed.
 */
function asDuelFailure(error: PostgrestError): MutationResult {
  if (error.code === DUEL_PENDING_CAP_SQLSTATE) {
    // The cap is interpolated from CONFIG, never typed into the string:
    // design-stack.md §4 rule 4 forbids hardcoding a tunable, and a sentence
    // that said "3" while the constant said 5 would be a lie the type system
    // could not see. The SQL side counts against its own copy of the same
    // number — one more twin to keep in step, flagged in config.ts.
    return fail("duel-pending-cap", {
      values: { max: CONFIG.DUEL_MAX_PENDING_PER_CHALLENGER },
    });
  }
  if (
    error.code === DUEL_DUPLICATE_PAIR_SQLSTATE ||
    error.code === UNIQUE_VIOLATION_SQLSTATE
  ) {
    return fail("duel-already-pending");
  }
  return unexpected(error);
}

export interface CreatedBet {
  betId: string;
  createdAt: string;
  /** In `position` order — the ids types.ts's ordered options array needs. */
  optionIds: string[];
  /** As stored: the RPC round-trips it, so no browser clock reaches the row. */
  closesAt: string;
}

/**
 * DOM-007/008/009/017. `options` goes over as raw labels — blank slots and all
 * — because the RPC drops them exactly as `validateBetDraft` does, and it is
 * the RPC that owns the two-option floor (MIN_BET_OPTIONS) server-side.
 */
export async function createBet(
  supabase: Client,
  input: {
    teamId: string;
    title: string;
    iconEmoji?: string;
    options: string[];
    closesAt: string;
    maxWagerPerUser: number;
  },
): Promise<MutationResult & { bet?: CreatedBet }> {
  const { data, error } = await supabase.rpc("create_bet", {
    p_team_id: input.teamId,
    p_title: input.title,
    p_icon_emoji: input.iconEmoji ?? null,
    p_options: input.options,
    p_closes_at: input.closesAt,
    p_max_wager_per_user: input.maxWagerPerUser,
  });

  if (error) return asFailure(error);

  const row = data as {
    bet_id: string;
    created_at: string;
    closes_at: string;
    option_ids: string[];
  };
  return {
    ok: true,
    bet: {
      betId: row.bet_id,
      createdAt: row.created_at,
      closesAt: row.closes_at,
      optionIds: row.option_ids,
    },
  };
}

export interface PlacedWager {
  wagerId: string;
  placedAt: string;
  /** Post-debit balance, straight from the transaction that debited it. */
  balanceAfter: number;
}

/** DOM-013/014/016/017: the stake and its debit, in one transaction (§4.6). */
export async function placeWager(
  supabase: Client,
  input: { betId: string; optionId: string; amount: number },
): Promise<MutationResult & { wager?: PlacedWager }> {
  const { data, error } = await supabase.rpc("place_wager", {
    p_bet_id: input.betId,
    p_option_id: input.optionId,
    p_amount: input.amount,
  });

  if (error) return asFailure(error);

  const row = data as { wager_id: string; placed_at: string; balance_after: number };
  return {
    ok: true,
    wager: {
      wagerId: row.wager_id,
      placedAt: row.placed_at,
      balanceAfter: row.balance_after,
    },
  };
}

/**
 * DOM-011/DOM-012. Returns the `closesAt` the server wrote — the moment
 * open→closed happened, which is what every countdown and "closed Xm ago"
 * then reads.
 */
export async function closeBetEarly(
  supabase: Client,
  betId: string,
): Promise<MutationResult & { closedAt?: string }> {
  const { data, error } = await supabase.rpc("close_bet_early", {
    p_bet_id: betId,
  });
  return error ? asFailure(error) : { ok: true, closedAt: data as string };
}

/**
 * DOM-033/034 hard delete. The returned deltas are the money reversal the
 * database applied (settlement.ts's reverseBet, mirrored in SQL — see the
 * migration header for why that mirror exists rather than the client sending
 * its own deltas).
 */
export async function deleteBet(
  supabase: Client,
  betId: string,
): Promise<MutationResult & { deltas?: SettlementDelta[] }> {
  const { data, error } = await supabase.rpc("delete_bet", { p_bet_id: betId });

  if (error) return asFailure(error);

  const rows = (data ?? []) as {
    user_id: string;
    balance_delta: number;
    profit_loss_delta: number;
  }[];
  return {
    ok: true,
    deltas: rows.map((row) => ({
      userId: row.user_id,
      balanceDelta: row.balance_delta,
      profitLossDelta: row.profit_loss_delta,
    })),
  };
}

/**
 * DOM-016/018/019 + DOM-012. The returned deltas are the payouts (or void
 * refunds) Postgres actually applied — the SQL twin of `settleBet`, the same
 * one `delete_bet` later unwinds — so what the screen shows is what the
 * database wrote rather than a second, local computation of it.
 *
 * Per decision §4.6 this produces no ledger rows: resolution moves stored
 * balances and realized P/L, and is not a transfer.
 *
 * ONE function resolves every bet, pool and duel alike (Extra Phase 2 task 8).
 * `resolve_bet` was extended with a fourth argument rather than joined by a
 * sibling `resolve_duel`, so there is still exactly one place in the schema
 * that writes a resolution and exactly one here that calls it. What forks is
 * authorization, inside the RPC: `app.can_resolve_bet` reads the bet's `kind`
 * and routes a pool bet to `app.can_manage_bet` (creator-or-moderator,
 * verbatim and unwidened) and a duel to `app.can_resolve_duel` (the named
 * mediator, or any moderator when the row says so — never a participant, D6).
 * Widening `can_manage_bet` to admit the mediator instead would have been one
 * line and would have handed them `delete_bet` and `close_bet_early` as well,
 * which is this phase's named risk 1.
 *
 * `p_void_reason` (D3) rides along on every call, `null` for a winner and
 * `null` for a pool-bet void — the column stays NULL for every pool bet ever
 * written, which is why nothing needed backfilling. When a human resolver
 * voids a duel without saying why, the RPC itself defaults the stored value to
 * `'mediator'`; the client does not guess it, because `undefined` here means
 * "the caller expressed no reason" and only the server knows whether the
 * caller was a mediator. The reason never changes the money: `app.settle_bet`
 * is handed `'void'` and refunds every stake in full regardless of it.
 */
export async function resolveBet(
  supabase: Client,
  input: { betId: string; resolution: BetResolution },
): Promise<MutationResult & { deltas?: SettlementDelta[] }> {
  const { data, error } = await supabase.rpc("resolve_bet", {
    p_bet_id: input.betId,
    p_kind: input.resolution.kind,
    p_winning_option_id:
      input.resolution.kind === "winner" ? input.resolution.winningOptionId : null,
    // `?? null` and not `?? "mediator"`: the union's `reason` is optional
    // precisely so a caller can decline to state one, and PostgREST needs an
    // explicit null to let the RPC's own default apply.
    p_void_reason:
      input.resolution.kind === "void" ? (input.resolution.reason ?? null) : null,
  });

  if (error) return asFailure(error);

  const rows = (data ?? []) as {
    user_id: string;
    balance_delta: number;
    profit_loss_delta: number;
  }[];
  return {
    ok: true,
    deltas: rows.map((row) => ({
      userId: row.user_id,
      balanceDelta: row.balance_delta,
      profitLossDelta: row.profit_loss_delta,
    })),
  };
}

// --- duels (Extra Phase 2, D1-D9) ------------------------------------------------
// Three write paths, and between them they move money twice and never on
// credit (D5): the challenger's stake leaves at `startDuel`, the challengee's
// at `acceptDuel`, and any void — declined, expired, cascade, pre-acceptance
// delete — hands both back through the refund machinery that already existed.
// There is no escrow row and no held-balance column anywhere in this file or
// the schema behind it; the coins are simply gone from a balance and come back
// on a void, exactly as `reverseBet` already returns stakes.

/** What `create_duel` hands back — everything about the new duel that the
 * client could not have known before asking, in one round trip. */
export interface StartedDuel {
  betId: string;
  createdAt: string;
  /** The accept deadline the SERVER computed, `now() + app.duel_accept_window()`. */
  closesAt: string;
  /** In `position` order: [0] is the challenger's side, [1] the challengee's. */
  optionIds: string[];
  /**
   * As STORED, which is not always as sent (D9). In a `restricted` team
   * `create_duel` coerces this to `true` no matter what the challenger ticked,
   * so the client must take the server's answer rather than echo its own
   * input — the stored row is the truth about who may resolve this duel.
   */
  anyModerator: boolean;
  /** The challenger's own wager on option 0, placed inside the same transaction. */
  wagerId: string;
  /** Post-debit balance, straight from the transaction that debited it. */
  balanceAfter: number;
}

/**
 * Send a challenge (D1/D5/D9, roadmap task 8). One RPC, one transaction, and
 * it writes SIX rows: the `bets` row (`kind='duel'`, `state='open'`,
 * `closes_at = now() + 24h`, `max_wager_per_user = stake`), two `bet_options`
 * generated from the two participants' display names, the `bet_duels` side
 * row, and the challenger's own wager on option 0 — debited through the very
 * same lock-then-debit sequence `place_wager` uses, because a stake that left
 * a balance by any other route is a stake `delete_bet` could not unwind.
 *
 * Three things this signature says that are easy to misread:
 *
 *   - `anyModerator` goes over as the challenger's INTENT and comes back in
 *     `StartedDuel.anyModerator` as what was actually stored. D9's coercion
 *     lives in `create_duel` and only there: it reads the team's `access_mode`
 *     inside this same transaction and stores `p_any_moderator or (access_mode
 *     = 'restricted')`. Not a CHECK (which would re-evaluate against the
 *     team's CURRENT mode on any later UPDATE and retroactively invalidate a
 *     duel created under the other one) and not a trigger (same objection,
 *     plus it would fire for the seed). A restricted team does not REFUSE a
 *     duel with `anyModerator: false` — `validateDuelDraft` has no such issue
 *     code — it silently upgrades it, so nobody ever sees an error for a box
 *     the UI had already checked and disabled for them.
 *   - `mediatorId` is nullable and that is a real state, not a "not chosen
 *     yet": a duel with no named mediator relies on the any-moderator pool,
 *     and `bet_duels_has_a_resolver` refuses the pair being empty at once.
 *   - There is no `closesAt` input. The accept window is a config constant
 *     with a SQL twin (`CONFIG.DUEL_ACCEPT_WINDOW_HOURS` /
 *     `app.duel_accept_window()`), the server owns the clock, and a browser
 *     that could name its own deadline could name one ten years out.
 *
 * `asDuelFailure`, not `asFailure`, because this is the one call the anti-spam
 * trigger can refuse with a code instead of a sentence.
 */
export async function startDuel(
  supabase: Client,
  input: {
    teamId: string;
    title: string;
    iconEmoji?: string;
    challengeeId: string;
    mediatorId: string | null;
    anyModerator: boolean;
    stake: number;
  },
): Promise<MutationResult & { duel?: StartedDuel }> {
  const { data, error } = await supabase.rpc("create_duel", {
    p_team_id: input.teamId,
    p_title: input.title,
    p_icon_emoji: input.iconEmoji ?? null,
    p_challengee_id: input.challengeeId,
    p_mediator_id: input.mediatorId,
    p_any_moderator: input.anyModerator,
    p_stake: input.stake,
  });

  if (error) return asDuelFailure(error);

  const row = data as {
    bet_id: string;
    created_at: string;
    closes_at: string;
    option_ids: string[];
    any_moderator: boolean;
    wager_id: string;
    balance_after: number;
  };
  return {
    ok: true,
    duel: {
      betId: row.bet_id,
      createdAt: row.created_at,
      closesAt: row.closes_at,
      optionIds: row.option_ids,
      anyModerator: row.any_moderator,
      wagerId: row.wager_id,
      balanceAfter: row.balance_after,
    },
  };
}

/** What `accept_duel` hands back: the two clocks it moved and the debit it made. */
export interface AcceptedDuel {
  /** `bet_duels.accepted_at`, the server's clock — never the browser's. */
  acceptedAt: string;
  /**
   * The bet's NEW `closes_at`, overwritten to the same instant. A duel on
   * accept does exactly what `close_bet_early` does (D2): `state='closed'`,
   * `closes_at=now()`, landing it in the AWAITING RESULT state the design
   * system already specifies. Which is why `Duel.expiresAt` exists as a
   * separate stored column — after this call the bet no longer remembers when
   * the challenge would have lapsed, and the duel row still does.
   */
  closesAt: string;
  /** The challengee's wager on option 1. */
  wagerId: string;
  balanceAfter: number;
}

/**
 * Accept a challenge (D2/D5, roadmap task 8). Bare `betId` like
 * `closeBetEarly` and `deleteBet` next door, because there is genuinely
 * nothing else to send: who is accepting is `auth.uid()`, which side they take
 * is fixed by `bet_duels.challengee_id`, and the stake is fixed by the row —
 * an "amount" parameter here would be a second, disagreeable copy of a number
 * the challenger already chose.
 *
 * `accept_duel` sweeps stale duels for the team before doing anything else
 * (D8 half (b) again, the same sweep `loadTeamData` runs), so a challengee who
 * opens a 25-hour-old challenge and taps accept is refused because the duel is
 * already void, rather than accepting a bet whose deadline passed while the
 * tab sat open. The client-side twin of that guard is `computeDuelPhase`,
 * which is what stops the button from being offered in the first place; this
 * one is what makes it true.
 *
 * DOM-014 is absolute here: if the challengee cannot cover the stake at THIS
 * moment, the accept is refused with `Not enough coins.` — `validateWager`'s
 * own sentence, byte-identical, as every RPC in this repo does — and the
 * surface offers `declineDuel(betId, "insufficient-funds")` instead. Nobody
 * ever goes negative and nothing is ever accepted on credit.
 */
export async function acceptDuel(
  supabase: Client,
  betId: string,
): Promise<MutationResult & { accepted?: AcceptedDuel }> {
  const { data, error } = await supabase.rpc("accept_duel", { p_bet_id: betId });

  if (error) return asFailure(error);

  const row = data as {
    accepted_at: string;
    closes_at: string;
    wager_id: string;
    balance_after: number;
  };
  return {
    ok: true,
    accepted: {
      acceptedAt: row.accepted_at,
      closesAt: row.closes_at,
      wagerId: row.wager_id,
      balanceAfter: row.balance_after,
    },
  };
}

/**
 * The two reasons a challengee may attach to their own refusal — a deliberate
 * narrowing of `BetVoidReason`'s five, and the type is doing real work.
 *
 * The other three are not the challengee's to claim: `'mediator'` belongs to
 * whoever resolved the duel, `'expired'` is written by `app.expire_stale_duels`
 * with no human in the loop at all, and `'participant-left'` is written by the
 * kick/ban/leave cascade. `decline_duel` refuses anything outside this pair
 * server-side too — this type is not the guarantee, it is what stops the
 * mistake being made in TypeScript in the first place, where the compiler can
 * say so instead of a round trip.
 *
 * `'insufficient-funds'` exists as a distinct value rather than collapsing
 * into `'declined'` because the owner requires the history row to say the
 * challengee COULDN'T afford it (D3) — a different sentence from "wouldn't".
 * It is a suffix on the void, not a second kind of void: both refund both
 * sides in full and both read as `VOID · REFUNDED`.
 */
export type DuelDeclineReason = Extract<
  BetVoidReason,
  "declined" | "insufficient-funds"
>;

/**
 * Decline a challenge (D3/D5, roadmap task 8), only while it is still
 * unaccepted and only by the challengee.
 *
 * Returns deltas shaped exactly like `deleteBet`'s and for the same reason:
 * this voids a bet that already has money in it (the challenger's stake left
 * at `startDuel`), so the caller needs to know what Postgres actually moved
 * rather than recomputing it locally and hoping the two agree. The refund is
 * `app.settle_bet(bet, 'void', null)` — the SQL twin of `settleBet`, the same
 * function a mediator's void and a resolution both go through. There is no
 * duel-specific payout formula anywhere in this feature, deliberately: a
 * "simpler" direct transfer would end up a coin apart from `resolve_bet`
 * somewhere and break `delete_bet`'s reversal, which is this phase's risk 3.
 *
 * Under the hood the void takes the two legal state hops — `open` → `closed`,
 * then `closed` → `resolved` — inside one transaction, because
 * `enforce_bet_state_transition` refuses `open` → `resolved` and is the only
 * trigger in the schema with no service-context escape hatch. It stays that
 * way; "waiting to be accepted" is not a fourth `bet_state` precisely so this
 * trigger never has to learn about duels (D1/D2).
 *
 * `reason` defaults to `'declined'`, the ordinary case. The surface passes
 * `'insufficient-funds'` only from the path `acceptDuel` refused for money.
 */
export async function declineDuel(
  supabase: Client,
  betId: string,
  reason: DuelDeclineReason = "declined",
): Promise<MutationResult & { deltas?: SettlementDelta[] }> {
  const { data, error } = await supabase.rpc("decline_duel", {
    p_bet_id: betId,
    p_reason: reason,
  });

  if (error) return asFailure(error);

  const rows = (data ?? []) as {
    user_id: string;
    balance_delta: number;
    profit_loss_delta: number;
  }[];
  return {
    ok: true,
    deltas: rows.map((row) => ({
      userId: row.user_id,
      balanceDelta: row.balance_delta,
      profitLossDelta: row.profit_loss_delta,
    })),
  };
}

/**
 * UX-018 + DOM-030. The one write in this file that is NOT an RPC: a comment
 * is a single row, moves no money, and `comments_insert_own` (Phase 3) already
 * states the whole rule — membership of the bet's team, and authorship pinned
 * to the caller. DOM-030 rules out the moderation surface that would be the
 * only other reason to funnel it through a function.
 */
export async function addComment(
  supabase: Client,
  input: { betId: string; userId: string; body: string },
): Promise<MutationResult & { comment?: { id: string; createdAt: string } }> {
  const { data, error } = await supabase
    .from("comments")
    .insert({ bet_id: input.betId, user_id: input.userId, body: input.body })
    .select("id, created_at")
    .single();

  if (error) return asFailure(error);

  const row = data as { id: string; created_at: string };
  return { ok: true, comment: { id: row.id, createdAt: row.created_at } };
}

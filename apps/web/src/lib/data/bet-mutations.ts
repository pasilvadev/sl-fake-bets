import type { BetResolution, SettlementDelta } from "@repo/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fail, type MutationResult } from "./result";

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
 */

type Client = SupabaseClient;

function asFailure(error: PostgrestError): MutationResult {
  return fail(error.message);
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

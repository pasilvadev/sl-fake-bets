import { describe, expect, it } from "vitest";
import { deriveProfitLoss } from "./ledger";
import { getPoolStats } from "./pari-mutuel";
import {
  canAcceptDuel,
  canCreateBet,
  canDeclineDuel,
  canDeleteDuel,
  canResolveDuel,
  canStartDuel,
  mustForceAnyModerator,
} from "./permissions";
import {
  validateDuelDraft,
  type DuelDraft,
  type ValidationCode,
} from "./validation";
import {
  settleBet,
  voidDuelsForDepartingMember,
  type SettlementDelta,
} from "./settlement";
import { computeDuelPhase, computeEffectiveState } from "./state-machine";
import type {
  Bet,
  BetResolution,
  Duel,
  OptionPoolStat,
  Team,
  Transaction,
  Wager,
} from "./types";

/**
 * Extra Phase 2 regression (plan-mvp-roadmap.md §8, "Extra Phase 2 — 1v1 duel
 * bets: domain, schema & write paths", task 14).
 *
 * The headline is what this file does NOT contain: a single expectation about
 * a duel-specific payout formula, because there is no duel-specific payout
 * formula. Task 6 is phrased as a PROOF rather than an implementation — "run
 * the worked case through the existing `settleBet` … if the numbers come out
 * otherwise, stop and report — do not bend `settleBet`, which pins Phases 1–7"
 * — and the first describe below is that proof, written out longhand so the
 * next reader can check the arithmetic without running anything. Everything
 * after it is the lifecycle around that proof: voids, expiry, the participant
 * cascade, the phase view, and D9's permission fork.
 *
 * Why the fixtures are local to this file instead of `mock-data.ts`'s
 * `mockDuels`. Those two fixture sets answer different questions and it is
 * worth being explicit about it, because "just reuse the mocks" is the obvious
 * first instinct. `mock-data.ts` is one busy team whose hand-typed balances are
 * pinned by `settlement.test.ts` and `team-lifecycle.test.ts`; every row added
 * there has to reconcile against a ledger built for other phases, and its job
 * is to prove that duels COMPOSE with everything else. This file wants the
 * opposite: a small team whose entire history IS the duel cases under test, so
 * that a failing expectation names the rule that broke instead of a fixture
 * balance that drifted three phases ago. The two are complements, not
 * duplicates, and neither is redundant.
 *
 * The fixture team `t-duel` and its arithmetic, so the hand-typed member
 * numbers below can be audited at a glance. Every member starts with one
 * 500-coin onboarding grant and nothing else; stakes leave the balance at
 * placement (decision §4.6), credits arrive only from RESOLVED bets:
 *
 *   member  ledger  − stakes  + credits  = coinBalance    profitLoss
 *   u-ld      500       55        100        545             +60
 *   u-mod     500       60          0        440             −60
 *   u-ch      500      155        190        535             +50
 *   u-cg      500      120         50        430             −50
 *   u-md      500        0          0        500               0
 *
 * P/L sums to zero across the team, which is assumption A-3 (no rake, 100%
 * redistributed) showing up as a checksum rather than as a claim.
 *
 * Cast, fixed for the whole file so the describes read as one story:
 *   u-ld  "Rafa"  leader     — challengee on two duels (a participant leader is
 *                              still a participant; A-1 does not exempt anyone)
 *   u-mod "Duda"  moderator  — never a participant, so always in the
 *                              any-moderator pool
 *   u-ch  "Caio"  member     — the challenger in four of the five duels
 *   u-cg  "Nina"  member     — the challengee who accepted twice
 *   u-md  "Vic"   member     — the NAMED MEDIATOR and never a participant,
 *                              which is what makes the D7 mediator-departure
 *                              case unambiguous below
 */

const NOW = Date.parse("2026-09-06T12:00:00Z");

const LEADER = "u-ld";
const MODERATOR = "u-mod";
const CHALLENGER = "u-ch";
const CHALLENGEE = "u-cg";
const MEDIATOR = "u-md";
const STRANGER = "u-99";

const duelTeam: Team = {
  id: "t-duel",
  name: "Duel Club",
  leaderId: LEADER,
  accessMode: "free-for-all",
  // Permanent only — this fixture's cast is all about duel lifecycle, not
  // invite links, so one link in the D7 shape is enough to satisfy the type.
  invites: [
    {
      id: "inv-duel-club",
      code: "duel-club",
      createdBy: LEADER,
      createdAt: "2026-08-30T00:00:00Z",
      expiresAt: null,
    },
  ],
  bannedUserIds: [],
  createdAt: "2026-08-30T00:00:00Z",
  members: [
    { userId: LEADER, role: "moderator", coinBalance: 545, profitLoss: 60, joinedAt: "2026-08-30T00:00:00Z" },
    { userId: MODERATOR, role: "moderator", coinBalance: 440, profitLoss: -60, joinedAt: "2026-08-30T00:00:00Z" },
    { userId: CHALLENGER, role: "member", coinBalance: 535, profitLoss: 50, joinedAt: "2026-08-30T00:00:00Z" },
    { userId: CHALLENGEE, role: "member", coinBalance: 430, profitLoss: -50, joinedAt: "2026-08-30T00:00:00Z" },
    { userId: MEDIATOR, role: "member", coinBalance: 500, profitLoss: 0, joinedAt: "2026-08-30T00:00:00Z" },
  ],
};

const duelTransactions: Transaction[] = duelTeam.members.map((m) => ({
  id: `tx-${m.userId}`,
  teamId: duelTeam.id,
  userId: m.userId,
  kind: "onboarding-grant",
  amount: 500,
  description: "Welcome to Duel Club",
  balanceAfter: 500,
  createdAt: "2026-08-30T00:00:00Z",
}));

/**
 * The bets. Order matters and is asserted on: `voidDuelsForDepartingMember`
 * returns bet ids in `bets` order, which is the contract its callers diff
 * against a local list.
 *
 * Every duel's `creatorId` is its challenger — `create_duel` inserts the
 * `bets` row on the challenger's behalf in the same transaction — and every
 * duel's `maxWagerPerUser` equals its stake, which is task 6's structural
 * guarantee rather than a preference: with the per-user cap equal to the
 * stake, a third wager is impossible even if a write path ever leaked, which
 * is a cheaper promise than a new payout formula. There is an explicit
 * expectation on that below so a fixture typo cannot quietly break the
 * premise the whole phase rests on.
 */
const duelBets: Bet[] = [
  {
    id: "b-pool",
    teamId: "t-duel",
    creatorId: MODERATOR,
    title: "Ordinary pool bet, for company",
    kind: "pool",
    options: [
      { id: "b-pool-o1", label: "Yes" },
      { id: "b-pool-o2", label: "No" },
    ],
    state: "resolved",
    resolution: { kind: "winner", winningOptionId: "b-pool-o1" },
    closesAt: "2026-09-03T00:00:00Z",
    maxWagerPerUser: 100,
    createdAt: "2026-09-01T00:00:00Z",
  },
  {
    id: "b-duel-won",
    teamId: "t-duel",
    creatorId: CHALLENGER,
    title: "Caio vs Nina — first to finish",
    kind: "duel",
    options: [
      { id: "b-duel-won-o1", label: "Caio" },
      { id: "b-duel-won-o2", label: "Nina" },
    ],
    state: "resolved",
    resolution: { kind: "winner", winningOptionId: "b-duel-won-o1" },
    // Accepted, so `closes_at` was overwritten to the acceptance moment (D2 —
    // a duel does exactly what `close_bet_early` already does).
    closesAt: "2026-09-02T11:30:00Z",
    maxWagerPerUser: 50,
    createdAt: "2026-09-02T10:00:00Z",
  },
  {
    id: "b-duel-void",
    teamId: "t-duel",
    creatorId: CHALLENGER,
    title: "Caio vs Nina — the rematch nobody could call",
    kind: "duel",
    options: [
      { id: "b-duel-void-o1", label: "Caio" },
      { id: "b-duel-void-o2", label: "Nina" },
    ],
    state: "resolved",
    resolution: { kind: "void", reason: "mediator" },
    closesAt: "2026-09-03T09:45:00Z",
    maxWagerPerUser: 50,
    createdAt: "2026-09-03T09:00:00Z",
  },
  {
    id: "b-duel-expired",
    teamId: "t-duel",
    creatorId: CHALLENGER,
    title: "Caio vs Rafa — never answered",
    kind: "duel",
    options: [
      { id: "b-duel-expired-o1", label: "Caio" },
      { id: "b-duel-expired-o2", label: "Rafa" },
    ],
    state: "resolved",
    resolution: { kind: "void", reason: "expired" },
    // Never accepted, so `closesAt` is still the accept deadline it was
    // created with, and equals the duel row's `expiresAt`.
    closesAt: "2026-09-05T08:00:00Z",
    maxWagerPerUser: 40,
    createdAt: "2026-09-04T08:00:00Z",
  },
  {
    id: "b-duel-pending",
    teamId: "t-duel",
    creatorId: CHALLENGEE,
    title: "Nina vs Rafa — still waiting",
    kind: "duel",
    options: [
      { id: "b-duel-pending-o1", label: "Nina" },
      { id: "b-duel-pending-o2", label: "Rafa" },
    ],
    state: "open",
    closesAt: "2026-09-07T09:00:00Z",
    maxWagerPerUser: 20,
    createdAt: "2026-09-06T09:00:00Z",
  },
  {
    id: "b-duel-accepted",
    teamId: "t-duel",
    creatorId: CHALLENGER,
    title: "Caio vs Rafa — awaiting a ruling",
    kind: "duel",
    options: [
      { id: "b-duel-accepted-o1", label: "Caio" },
      { id: "b-duel-accepted-o2", label: "Rafa" },
    ],
    state: "closed",
    closesAt: "2026-09-05T14:20:00Z",
    maxWagerPerUser: 15,
    createdAt: "2026-09-05T14:00:00Z",
  },
];

/**
 * The duel side rows, 1:1 with the `kind: "duel"` bets above by `betId` (D1).
 * `b-pool` deliberately has none — the absence of a row is what makes it a
 * pool bet to every consumer here, which is exactly the discrimination
 * `voidDuelsForDepartingMember` performs.
 *
 * `u-md` is the named mediator on four of the five and a participant in none.
 * That is not decoration: it is the only arrangement under which "a departing
 * mediator voids nothing" (D7) can be asserted without the assertion also
 * being satisfiable by the resolved-bets filter, which would make the test
 * pass for the wrong reason.
 *
 * The pairs are also chosen so that no two still-PENDING duels share a
 * (challenger, challengee) pair, which is task 9's rule and would refuse the
 * second one in the real schema. `b-duel-expired` and `b-duel-accepted` are
 * both `u-ch → u-ld` and legal for two independent reasons: the second has an
 * `acceptedAt`, and the first is resolved.
 *
 * That second reason only became true in `20260906130400_duel_pair_rule_fix.sql`.
 * The rule originally shipped as a partial unique index `where accepted_at is
 * null`, which never stops matching a declined or expired duel — so a single
 * decline locked a pair out of each other for good. The fix moved the rule
 * into `create_duel` under the lock it already takes and dropped the index.
 * These fixtures were legal under both readings, which is why they are written
 * to satisfy the stricter one.
 */
const duelRows: Duel[] = [
  {
    betId: "b-duel-won",
    challengerId: CHALLENGER,
    challengeeId: CHALLENGEE,
    mediatorId: MEDIATOR,
    anyModerator: false,
    stake: 50,
    acceptedAt: "2026-09-02T11:30:00Z",
    expiresAt: "2026-09-03T10:00:00Z",
  },
  {
    betId: "b-duel-void",
    challengerId: CHALLENGER,
    challengeeId: CHALLENGEE,
    mediatorId: MEDIATOR,
    anyModerator: false,
    stake: 50,
    acceptedAt: "2026-09-03T09:45:00Z",
    expiresAt: "2026-09-04T09:00:00Z",
  },
  {
    betId: "b-duel-expired",
    challengerId: CHALLENGER,
    challengeeId: LEADER,
    mediatorId: MEDIATOR,
    anyModerator: false,
    stake: 40,
    acceptedAt: null,
    expiresAt: "2026-09-05T08:00:00Z",
  },
  {
    betId: "b-duel-pending",
    challengerId: CHALLENGEE,
    challengeeId: LEADER,
    mediatorId: MEDIATOR,
    anyModerator: false,
    stake: 20,
    acceptedAt: null,
    expiresAt: "2026-09-07T09:00:00Z",
  },
  {
    betId: "b-duel-accepted",
    challengerId: CHALLENGER,
    challengeeId: LEADER,
    // No named mediator: this duel leans entirely on the any-moderator pool
    // (D7's additive half standing alone), which is what makes it the case
    // that proves a moderator who IS a participant is still excluded.
    mediatorId: null,
    anyModerator: true,
    stake: 15,
    acceptedAt: "2026-09-05T14:20:00Z",
    expiresAt: "2026-09-06T14:00:00Z",
  },
];

/**
 * Wagers. A duel's stakes are ordinary `wagers` rows through the same
 * lock-then-debit sequence `place_wager` uses (D5) — there is no escrow
 * column and there must not be one — so this list is the only place a duel's
 * money exists before settlement. Challenger on position 0, challengee on
 * position 1, always.
 *
 * Note which duels have ONE wager: `b-duel-expired` and `b-duel-pending`,
 * the two nobody accepted. The challenger's coins left at creation; the
 * challengee's never left at all, and that asymmetry is the entire content of
 * the expiry pin further down.
 */
const duelWagers: Wager[] = [
  { id: "w-pool-ld", betId: "b-pool", userId: LEADER, optionId: "b-pool-o1", amount: 40, placedAt: "2026-09-01T01:00:00Z" },
  { id: "w-pool-mod", betId: "b-pool", userId: MODERATOR, optionId: "b-pool-o2", amount: 60, placedAt: "2026-09-01T02:00:00Z" },

  { id: "w-won-ch", betId: "b-duel-won", userId: CHALLENGER, optionId: "b-duel-won-o1", amount: 50, placedAt: "2026-09-02T10:00:00Z" },
  { id: "w-won-cg", betId: "b-duel-won", userId: CHALLENGEE, optionId: "b-duel-won-o2", amount: 50, placedAt: "2026-09-02T11:30:00Z" },

  { id: "w-void-ch", betId: "b-duel-void", userId: CHALLENGER, optionId: "b-duel-void-o1", amount: 50, placedAt: "2026-09-03T09:00:00Z" },
  { id: "w-void-cg", betId: "b-duel-void", userId: CHALLENGEE, optionId: "b-duel-void-o2", amount: 50, placedAt: "2026-09-03T09:45:00Z" },

  { id: "w-exp-ch", betId: "b-duel-expired", userId: CHALLENGER, optionId: "b-duel-expired-o1", amount: 40, placedAt: "2026-09-04T08:00:00Z" },

  { id: "w-pend-cg", betId: "b-duel-pending", userId: CHALLENGEE, optionId: "b-duel-pending-o1", amount: 20, placedAt: "2026-09-06T09:00:00Z" },

  { id: "w-acc-ch", betId: "b-duel-accepted", userId: CHALLENGER, optionId: "b-duel-accepted-o1", amount: 15, placedAt: "2026-09-05T14:00:00Z" },
  { id: "w-acc-ld", betId: "b-duel-accepted", userId: LEADER, optionId: "b-duel-accepted-o2", amount: 15, placedAt: "2026-09-05T14:20:00Z" },
];

function fixtureBet(id: string): Bet {
  const bet = duelBets.find((b) => b.id === id);
  if (!bet) throw new Error(`fixture bet ${id} is missing`);
  return bet;
}

function fixtureDuel(betId: string): Duel {
  const duel = duelRows.find((d) => d.betId === betId);
  if (!duel) throw new Error(`fixture duel for ${betId} is missing`);
  return duel;
}

function deltaFor(deltas: SettlementDelta[], userId: string): SettlementDelta {
  const delta = deltas.find((d) => d.userId === userId);
  if (!delta) throw new Error(`no settlement delta for ${userId}`);
  return delta;
}

function statFor(stats: OptionPoolStat[], optionId: string): OptionPoolStat {
  const stat = stats.find((s) => s.optionId === optionId);
  if (!stat) throw new Error(`no pool stat for ${optionId}`);
  return stat;
}

/** t-duel with fields swapped, for the D9 gate tests. */
function teamAs(overrides: Partial<Team>): Team {
  return { ...duelTeam, ...overrides };
}

/**
 * PIN 1 — task 6, and it is a PROOF, not a test of new code.
 *
 * The whole case, worked by hand so a failure here can be read without a
 * debugger. Two members, 50 each, on opposite options, `b-duel-won-o1` wins:
 *
 *   pool      = 50 + 50            = 100
 *   winTotal  = stakes on o1       =  50
 *   Caio      = floor(50 × 100 / 50) = 100 credited, P/L = 100 − 50 = +50
 *   Nina      = nothing on o1       =   0 credited, P/L =   0 − 50 = −50
 *
 * That is a 1:1 head-to-head payout falling straight out of the pari-mutuel
 * formula, with no branch anywhere in `settleBet` that knows what a duel is.
 * The floor never bites because a two-sided symmetric pool divides exactly,
 * and `getPoolStats` reports a flat 2.00x on each side for the same reason.
 *
 * If any number below comes out otherwise, the instruction from the roadmap
 * and from the phase contract is the same and it is not negotiable: STOP AND
 * REPORT. Do not adjust the expectation to match the output, and above all do
 * not "fix" `settleBet` — it pins Phases 1 through 7, `app.settle_bet` is its
 * SQL twin, and `reverseBet`/`delete_bet`'s reversal both unwind whatever it
 * produced. Risk 3 of this phase is precisely that a second, "simpler" direct
 * transfer gets written here; it would disagree with `resolve_bet` by a coin
 * somewhere and there would be no test to say where.
 */
describe("settleBet — the task-6 duel proof (two members, 50 each, opposite options)", () => {
  const bet = fixtureBet("b-duel-won");
  const duel = fixtureDuel("b-duel-won");
  const deltas = settleBet(bet, duelWagers, bet.resolution as BetResolution);

  it("pays the winner 100 for a 50 stake and charges the loser their 50", () => {
    expect(deltaFor(deltas, CHALLENGER)).toEqual({
      userId: CHALLENGER,
      balanceDelta: 100,
      profitLossDelta: 50,
    });
    expect(deltaFor(deltas, CHALLENGEE)).toEqual({
      userId: CHALLENGEE,
      balanceDelta: 0,
      profitLossDelta: -50,
    });
    // Exactly two people can ever be in here — see the maxWagerPerUser pin
    // below for why that is structural and not merely true today.
    expect(deltas).toHaveLength(2);
  });

  it("redistributes the whole pool and nets P/L to zero (A-3, no rake)", () => {
    expect(deltas.reduce((s, d) => s + d.balanceDelta, 0)).toBe(100);
    expect(deltas.reduce((s, d) => s + d.profitLossDelta, 0)).toBe(0);
  });

  it("shows a flat 2.00x on both sides while the duel is live", () => {
    const stats = getPoolStats(bet, duelWagers);
    const challengerSide = statFor(stats, "b-duel-won-o1");
    const challengeeSide = statFor(stats, "b-duel-won-o2");

    expect(challengerSide.total).toBe(50);
    expect(challengeeSide.total).toBe(50);
    expect(challengerSide.share).toBe(0.5);
    expect(challengeeSide.share).toBe(0.5);
    expect(challengerSide.multiplier).toBe(2);
    expect(challengeeSide.multiplier).toBe(2);
  });

  /**
   * The cap is the reason the two assertions above stay true forever rather
   * than only for well-behaved input. `create_duel` writes
   * `max_wager_per_user = stake`, so even if some future write path leaked a
   * third wager into a duel, DOM-017's existing check would refuse it before
   * the pool could stop being symmetric. Cheaper than a formula, and the
   * fixture has to obey it or this file is proving something about a shape the
   * schema cannot produce.
   */
  it("keeps the pool two-sided structurally: maxWagerPerUser === stake on every duel", () => {
    expect(bet.maxWagerPerUser).toBe(duel.stake);
    for (const row of duelRows) {
      expect(fixtureBet(row.betId).maxWagerPerUser, `cap on ${row.betId}`).toBe(
        row.stake,
      );
    }
  });
});

/**
 * PIN 2 — a void refunds both sides in full, with zero realized P/L.
 *
 * DOM-019 unchanged, and worth pinning on a DUEL specifically because this is
 * the path four different callers converge on: `decline_duel`, the expiry
 * sweep, the participant cascade, and a human resolver declaring a draw. All
 * four go through `app.void_duel`, which computes its refunds with
 * `app.settle_bet(p_bet_id, 'void', null)` — never a fresh delta computation —
 * so if any of them ever disagreed about the amount, it would be because
 * someone wrote a second money path, not because voids are subtle.
 */
describe("settleBet — a voided duel refunds both stakes (DOM-019)", () => {
  const bet = fixtureBet("b-duel-void");
  const deltas = settleBet(bet, duelWagers, bet.resolution as BetResolution);

  it("returns each participant's 50 and realizes nothing", () => {
    expect(deltaFor(deltas, CHALLENGER)).toEqual({
      userId: CHALLENGER,
      balanceDelta: 50,
      profitLossDelta: 0,
    });
    expect(deltaFor(deltas, CHALLENGEE)).toEqual({
      userId: CHALLENGEE,
      balanceDelta: 50,
      profitLossDelta: 0,
    });
    expect(deltas).toHaveLength(2);
  });

  /**
   * D3's "the reason is a SUFFIX, never a second state", made mechanical. The
   * void reason exists so the history row can say the challengee *couldn't
   * afford it* rather than a flat "void"; no payout path may branch on it, and
   * `settleBet` does not so much as read the field. Asserting the deltas are
   * identical across every reason (and across no reason at all, which is what
   * every void written before this phase carries) is what stops a future
   * "insufficient-funds refunds differently" from being added quietly.
   */
  it("ignores the void reason entirely — every reason refunds identically (D3)", () => {
    const baseline = settleBet(bet, duelWagers, { kind: "void" });
    for (const reason of [
      "mediator",
      "declined",
      "insufficient-funds",
      "expired",
      "participant-left",
    ] as const) {
      expect(
        settleBet(bet, duelWagers, { kind: "void", reason }),
        `void reason ${reason}`,
      ).toEqual(baseline);
    }
  });
});

/**
 * PIN 3 — `deriveProfitLoss` still reproduces the stored fields with duels in
 * the mix.
 *
 * This is the pin that connects the phase to Phase 7's consistency guard
 * (apps/web/src/lib/data/consistency-guard.ts), and it matters because the
 * guard does not have a notion of "kind": it replays EVERY resolved bet it can
 * see, and a duel is one of those. A duel that settled through some path the
 * guard cannot reproduce would not fail loudly — it would show up as drift on
 * a member's balance, attributed to nothing in particular, days later.
 *
 * The arithmetic below is the guard's own, verbatim:
 *
 *   coin_balance = Σ ledger amounts + Σ settlement credits − Σ stakes
 *   profit_loss  = deriveProfitLoss(resolved bets only)
 *
 * with the guard's `joinedAt` scoping dropped, since every fixture member
 * joined before the first row exists. The exit criteria's kick-mid-duel case
 * ("`deriveProfitLoss` replayed from the surviving membership's `joinedAt`
 * reports no drift") is the same check with that scope restored, run against
 * the live stack.
 */
describe("consistency guard arithmetic — duels replay like any other resolved bet", () => {
  const resolvedBets = duelBets.filter(
    (b): b is Bet & { resolution: BetResolution } =>
      b.state === "resolved" && b.resolution != null,
  );

  it("puts three duels and one pool bet in front of the guard, not just pool bets", () => {
    expect(resolvedBets.map((b) => b.id)).toEqual([
      "b-pool",
      "b-duel-won",
      "b-duel-void",
      "b-duel-expired",
    ]);
    expect(resolvedBets.filter((b) => b.kind === "duel")).toHaveLength(3);
  });

  it("deriveProfitLoss reproduces every stored profitLoss", () => {
    for (const member of duelTeam.members) {
      expect(
        deriveProfitLoss(member.userId, duelBets, duelWagers),
        `profitLoss of ${member.userId}`,
      ).toBe(member.profitLoss);
    }
  });

  it("ledger + settlement credits − stakes reproduces every stored coinBalance", () => {
    for (const member of duelTeam.members) {
      const ledger = duelTransactions
        .filter((t) => t.teamId === duelTeam.id && t.userId === member.userId)
        .reduce((s, t) => s + t.amount, 0);
      const stakes = duelWagers
        .filter((w) => w.userId === member.userId)
        .reduce((s, w) => s + w.amount, 0);
      const credits = resolvedBets.reduce(
        (s, bet) =>
          s +
          (settleBet(bet, duelWagers, bet.resolution).find(
            (d) => d.userId === member.userId,
          )?.balanceDelta ?? 0),
        0,
      );
      expect(
        ledger + credits - stakes,
        `coinBalance of ${member.userId}`,
      ).toBe(member.coinBalance);
    }
  });

  it("nets the team's realized P/L to zero (A-3 as a checksum)", () => {
    expect(
      duelTeam.members.reduce((s, m) => s + m.profitLoss, 0),
    ).toBe(0);
  });
});

/**
 * PIN 4 — an expired duel refunds ONLY the challenger.
 *
 * The asymmetry is the whole point and it is easy to get wrong in a hurry,
 * because "void refunds everyone" is true and yet the challengee here gets
 * nothing. They get nothing because they never paid anything: D5 moves money
 * twice and never on credit — the challenger's stake leaves at creation, the
 * challengee's at accept — so a challenge nobody answered has exactly one
 * wager row in it, and `settleBet` refunding "every stake" produces exactly
 * one delta. No special case, no `if (expired)`, and no entry at all for a
 * person who was merely invited.
 *
 * That is also why `app.expire_stale_duels` needs no refund logic of its own:
 * it runs the same two legal hops (`open→closed→resolved`, risk 2) and hands
 * the same `app.settle_bet(…, 'void', null)` the same one-sided pool.
 */
describe("settleBet — an expired, never-accepted duel refunds the challenger alone (D5/D8)", () => {
  const bet = fixtureBet("b-duel-expired");
  const duel = fixtureDuel("b-duel-expired");
  const deltas = settleBet(bet, duelWagers, bet.resolution as BetResolution);

  it("refunds the challenger's 40 and produces no delta for the challengee", () => {
    expect(deltas).toEqual([
      { userId: CHALLENGER, balanceDelta: 40, profitLossDelta: 0 },
    ]);
    expect(deltas.some((d) => d.userId === duel.challengeeId)).toBe(false);
  });

  it("leaves both participants' realized P/L untouched (a void is never a loss)", () => {
    // Caio's +50 comes from b-duel-won alone; the expired duel contributes 0,
    // which is what "zero realized P/L on a void" means when the member also
    // has other history.
    expect(deriveProfitLoss(CHALLENGER, [bet], duelWagers)).toBe(0);
    expect(deriveProfitLoss(duel.challengeeId, [bet], duelWagers)).toBe(0);
  });

  it("records WHY it died, so the history row is not a bare 'void' (D3)", () => {
    expect(bet.resolution).toEqual({ kind: "void", reason: "expired" });
    // Never accepted, so the bet's closesAt is still the accept deadline the
    // duel row also remembers — they only diverge once acceptance rewrites
    // closesAt to now() (D2).
    expect(bet.closesAt).toBe(duel.expiresAt);
  });
});

/**
 * PIN 5 — a departing participant VOIDS their duels rather than orphaning
 * them (task 11).
 *
 * The pool cascade (`removeMemberWagersInTeam`) is right for pools and wrong
 * here, which is the one sentence worth remembering: dropping one bettor from
 * a many-bettor pool leaves a valid pool that simply pays out differently,
 * while dropping one of exactly two leaves the survivor's stake with nothing
 * to settle against — a bet that can never legally resolve and a member who is
 * out real coins forever. So the duel is voided with
 * `void_reason='participant-left'` and the survivor refunded through
 * `settleBet`'s ordinary void branch. No new money path (risk 3).
 *
 * The mediator case is the half that looks like a missing test and is not.
 */
describe("voidDuelsForDepartingMember — the kick/ban/leave cascade (task 11, D7)", () => {
  it("names the departing participant's unresolved duels, in bets order", () => {
    // Rafa is challengee on b-duel-expired (resolved — history, untouchable),
    // b-duel-pending (open) and b-duel-accepted (closed). Both unresolved ones
    // come back, and in the order they appear in `bets`, which is the order
    // the callers diff against their local copy.
    expect(
      voidDuelsForDepartingMember(LEADER, "t-duel", duelBets, duelRows),
    ).toEqual(["b-duel-pending", "b-duel-accepted"]);

    expect(
      voidDuelsForDepartingMember(CHALLENGEE, "t-duel", duelBets, duelRows),
    ).toEqual(["b-duel-pending"]);

    expect(
      voidDuelsForDepartingMember(CHALLENGER, "t-duel", duelBets, duelRows),
    ).toEqual(["b-duel-accepted"]);
  });

  /**
   * D7, and the reason `u-md` is a participant in nothing: a departing
   * MEDIATOR strands no duel, so there is nothing here to void. Their
   * `bet_duels.mediator_id` goes null and `app.can_resolve_duel` falls back to
   * the any-moderator pool at READ time — a runtime fallback, never a stored
   * reassignment. If this ever starts returning ids, someone has decided a
   * duel needs its mediator to survive, and that is a design change, not a bug
   * fix.
   */
  it("voids nothing when the departing member is only a mediator (D7)", () => {
    expect(
      duelRows.filter((d) => d.mediatorId === MEDIATOR).length,
    ).toBeGreaterThan(0); // guard: the case is actually exercised
    expect(
      duelRows.some(
        (d) => d.challengerId === MEDIATOR || d.challengeeId === MEDIATOR,
      ),
    ).toBe(false); // guard: and not passing for the wrong reason
    expect(
      voidDuelsForDepartingMember(MEDIATOR, "t-duel", duelBets, duelRows),
    ).toEqual([]);
  });

  it("leaves resolved duels alone — settled history is not re-voided", () => {
    const ids = voidDuelsForDepartingMember(
      CHALLENGER,
      "t-duel",
      duelBets,
      duelRows,
    );
    expect(ids).not.toContain("b-duel-won"); // Caio won it; refunding now would invent coins
    expect(ids).not.toContain("b-duel-void"); // already voided once
    expect(ids).not.toContain("b-duel-expired");
  });

  it("stays inside one team, like every other cascade (DOM-013/032)", () => {
    const otherTeamBet: Bet = {
      id: "b-other-duel",
      teamId: "t-other",
      creatorId: CHALLENGEE,
      title: "Nina's duel in another team",
      kind: "duel",
      options: [
        { id: "b-other-duel-o1", label: "Nina" },
        { id: "b-other-duel-o2", label: "Someone else" },
      ],
      state: "open",
      closesAt: "2026-09-08T00:00:00Z",
      maxWagerPerUser: 10,
      createdAt: "2026-09-06T00:00:00Z",
    };
    const otherTeamDuel: Duel = {
      betId: "b-other-duel",
      challengerId: CHALLENGEE,
      challengeeId: STRANGER,
      mediatorId: null,
      anyModerator: true,
      stake: 10,
      acceptedAt: null,
      expiresAt: "2026-09-08T00:00:00Z",
    };

    // Leaving t-duel must not touch a duel Nina has running elsewhere: per-team
    // balances (DOM-013) mean the coins at stake there are a different pot.
    expect(
      voidDuelsForDepartingMember(
        CHALLENGEE,
        "t-duel",
        [...duelBets, otherTeamBet],
        [...duelRows, otherTeamDuel],
      ),
    ).toEqual(["b-duel-pending"]);
    expect(
      voidDuelsForDepartingMember(
        CHALLENGEE,
        "t-other",
        [...duelBets, otherTeamBet],
        [...duelRows, otherTeamDuel],
      ),
    ).toEqual(["b-other-duel"]);
  });

  /**
   * The other half of "voids rather than orphans": naming the duel is only
   * useful if voiding it actually makes the survivor whole. It does, through
   * the same branch pin 2 exercises — which is the point. `app.void_duel`
   * refunds with `app.settle_bet(p_bet_id, 'void', null)`, so nothing about
   * the cascade is a separate money path.
   */
  it("makes the survivor whole through the ordinary void branch, not a transfer", () => {
    const [betId] = voidDuelsForDepartingMember(
      LEADER,
      "t-duel",
      duelBets,
      duelRows,
    );
    expect(betId).toBe("b-duel-pending");

    // Nina staked 20 and Rafa never accepted, so the void hands Nina her 20
    // back and Rafa — the departing member — has nothing to receive anyway.
    expect(
      settleBet(fixtureBet("b-duel-pending"), duelWagers, {
        kind: "void",
        reason: "participant-left",
      }),
    ).toEqual([{ userId: CHALLENGEE, balanceDelta: 20, profitLossDelta: 0 }]);

    // And on the accepted one, both stakes come back — no orphan, no windfall.
    expect(
      settleBet(fixtureBet("b-duel-accepted"), duelWagers, {
        kind: "void",
        reason: "participant-left",
      }),
    ).toEqual([
      { userId: CHALLENGER, balanceDelta: 15, profitLossDelta: 0 },
      { userId: LEADER, balanceDelta: 15, profitLossDelta: 0 },
    ]);
  });
});

/**
 * PIN 6 — `computeDuelPhase`'s four arms, and the ORDER of its tests.
 *
 * D8 half (a). Three of the four arms are only correct because of the order
 * the function checks them in, and each one has a failure mode that looks
 * plausible:
 *
 *  - resolved before the clock, or every duel that ever finished reads
 *    "expired" forever after, since `closesAt` is in the past for all of them;
 *  - accepted before the clock, or every live duel awaiting a ruling reads
 *    "expired" the instant it is accepted, because accepting sets
 *    `closes_at = now()` (D2);
 *  - and only then the deadline, which by elimination is being asked about an
 *    unaccepted, unresolved challenge — the one case where it means anything.
 *
 * Each `it` below therefore asserts the phase AND the stored fields that would
 * make a wrongly-ordered implementation answer differently, so a regression
 * names its own cause.
 */
describe("computeDuelPhase — the four arms and their order (D8 half (a))", () => {
  it("reports 'settled' for a resolved duel however it got there", () => {
    const won = fixtureBet("b-duel-won");
    const expired = fixtureBet("b-duel-expired");

    expect(computeDuelPhase(won, fixtureDuel("b-duel-won"), NOW)).toBe("settled");
    // The trap: this one is resolved, unaccepted AND past its deadline. A
    // clock-first implementation calls it "expired" and the UI shows a
    // finished duel as a live one that lapsed.
    expect(fixtureDuel("b-duel-expired").acceptedAt).toBeNull();
    expect(Date.parse(expired.closesAt)).toBeLessThan(NOW);
    expect(computeDuelPhase(expired, fixtureDuel("b-duel-expired"), NOW)).toBe(
      "settled",
    );
  });

  it("reports 'accepted' even though acceptance puts closesAt in the past (D2)", () => {
    const bet = fixtureBet("b-duel-accepted");
    const duel = fixtureDuel("b-duel-accepted");

    // Accepting does exactly what close_bet_early does: state='closed',
    // closesAt=now(). So the deadline of every accepted duel is behind us, and
    // testing the clock before acceptance would call all of them expired.
    expect(bet.state).toBe("closed");
    expect(duel.acceptedAt).not.toBeNull();
    expect(Date.parse(bet.closesAt)).toBeLessThan(NOW);
    expect(computeDuelPhase(bet, duel, NOW)).toBe("accepted");
  });

  it("reports 'pending' while the challenge is still answerable", () => {
    const bet = fixtureBet("b-duel-pending");
    const duel = fixtureDuel("b-duel-pending");
    expect(Date.parse(bet.closesAt)).toBeGreaterThan(NOW);
    expect(computeDuelPhase(bet, duel, NOW)).toBe("pending");
  });

  /**
   * The case the whole lazy-expiry design exists for. Nothing has run: the
   * bet still says `open`, the duel row still says `acceptedAt: null`, no
   * sweep has touched the database, and the challenger's 20 coins are still
   * gone. The screen must still say "expired", because half (b)
   * (`app.expire_stale_duels`) is what makes the refund real and half (a) is
   * what keeps the screen honest until it runs — and on a deployment that
   * pauses after 7 idle days, "the sweep has not run for a week" is the
   * expected case, not an outage.
   */
  it("reports 'expired' before anything has persisted it (the whole point)", () => {
    const bet = fixtureBet("b-duel-pending");
    const duel = fixtureDuel("b-duel-pending");
    const afterDeadline = Date.parse("2026-09-07T09:00:01Z");

    expect(bet.state).toBe("open"); // nothing persisted
    expect(duel.acceptedAt).toBeNull(); // nobody answered
    expect(computeDuelPhase(bet, duel, afterDeadline)).toBe("expired");

    // And its pool-bet neighbour agrees on the same clock, which is D2's
    // claim that the EXISTING lifecycle carries a duel with no special case:
    // one deadline, two views over it, no fourth BetState.
    expect(computeEffectiveState(bet, afterDeadline)).toBe("closed");
  });

  it("treats the deadline as inclusive, matching SQL's closes_at <= now()", () => {
    const bet = fixtureBet("b-duel-pending");
    const duel = fixtureDuel("b-duel-pending");
    const exactly = Date.parse(bet.closesAt);

    expect(computeDuelPhase(bet, duel, exactly - 1)).toBe("pending");
    expect(computeDuelPhase(bet, duel, exactly)).toBe("expired");
  });
});

/**
 * PIN 7 — D9, the owner ruling that a restricted team does not block duels.
 *
 * `canStartDuel` is plain membership and `canCreateBet` is not, and the gap
 * between them IS the ruling: DOM-002 rations bets posted for a team to wager
 * into, while a duel is a private arrangement between two people who have
 * already agreed to it, so the access mode has nothing to ration. What the
 * leader keeps instead is `mustForceAnyModerator` — every duel created while
 * the team is restricted stores `any_moderator = true` regardless of what the
 * challenger ticked, so a moderator can always step in.
 *
 * The second `it` guards the other direction, which is the one that would
 * regress silently: the coercion is applied at CREATION and never
 * retroactively, so a live duel's resolver set is read off the ROW and never
 * re-derived from the team's current mode.
 */
describe("canStartDuel / mustForceAnyModerator — D9's two halves", () => {
  const restricted = teamAs({ accessMode: "restricted" });

  it("admits an ordinary member that canCreateBet refuses", () => {
    // The gap, stated as a pair. If these two ever agree again, an alias has
    // crept back in and an owner ruling has been undone with no other failure.
    expect(canCreateBet(restricted, CHALLENGER)).toBe(false);
    expect(canStartDuel(restricted, CHALLENGER)).toBe(true);

    // Membership is the whole check, so the access mode changes nothing…
    expect(canStartDuel(duelTeam, CHALLENGER)).toBe(true);
    // …and non-membership is still the one thing that refuses.
    expect(canStartDuel(restricted, STRANGER)).toBe(false);
    expect(canStartDuel(duelTeam, STRANGER)).toBe(false);

    // The guarantee the leader gets in exchange, which the compose form reads
    // to render the any-moderator control checked and disabled.
    expect(mustForceAnyModerator(restricted)).toBe(true);
    expect(mustForceAnyModerator(duelTeam)).toBe(false);
  });

  /**
   * D9 applies at creation and nothing rewrites history. `b-duel-pending` was
   * created with `anyModerator: false` and a named mediator; putting its team
   * into `restricted` must NOT retroactively hand every moderator the power to
   * resolve it, because the stored row is the truth about who may resolve THAT
   * duel. `canResolveDuel` reading `duel.anyModerator` rather than
   * `team.accessMode` is what makes that so.
   */
  it("never re-derives a live duel's resolver set from the team's current mode", () => {
    const duel = fixtureDuel("b-duel-pending");
    expect(duel.anyModerator).toBe(false);

    // Duda is a moderator and not a participant, and still cannot resolve it
    // in EITHER mode — the row says no.
    expect(canResolveDuel(duelTeam, MODERATOR, duel)).toBe(false);
    expect(canResolveDuel(restricted, MODERATOR, duel)).toBe(false);
    // Vic, the named mediator, can — in either mode, for the same reason.
    expect(canResolveDuel(duelTeam, MEDIATOR, duel)).toBe(true);
    expect(canResolveDuel(restricted, MEDIATOR, duel)).toBe(true);
  });

  /**
   * D7's exclusion, on the duel that leans entirely on the any-moderator pool.
   * A moderator who is one of the two participants is excluded by exactly the
   * same rule that excludes the creator — including the LEADER, because A-1
   * grants powers, not exemptions. Kept here rather than in its own describe
   * because it is the flip side of the same question: who the row lets in.
   */
  it("excludes participants from the any-moderator pool, leader included (D7)", () => {
    const duel = fixtureDuel("b-duel-accepted");
    expect(duel.anyModerator).toBe(true);
    expect(duel.mediatorId).toBeNull();

    expect(canResolveDuel(duelTeam, MODERATOR, duel)).toBe(true); // in the pool
    expect(canResolveDuel(duelTeam, LEADER, duel)).toBe(false); // challengee
    expect(canResolveDuel(duelTeam, CHALLENGER, duel)).toBe(false); // challenger
    expect(canResolveDuel(duelTeam, MEDIATOR, duel)).toBe(false); // plain member
    expect(canResolveDuel(duelTeam, STRANGER, duel)).toBe(false); // not a member
  });

  /**
   * D7'S STRANDING GUARANTEE, AND IT IS A MONEY TEST, NOT A PERMISSION TEST.
   * Added by the integration pass after this exact case was found broken
   * against the live database: with `anyModerator: false` and a named mediator
   * who had left the team, `resolve_bet` refused a plain moderator with "Only
   * the mediator or a moderator can resolve this duel." — true, and useless,
   * because there was no longer a mediator to be.
   *
   * The roadmap requires the fallback twice: task 11 ("resolvable by any
   * moderator the moment its named mediator is gone — a runtime check, not a
   * stored reassignment, and nothing is ever stranded") and an exit criterion
   * of its own ("The named mediator leaves the team; any moderator can still
   * resolve the duel"). The phase's implementation contract paraphrased
   * `canResolveDuel` in two clauses and dropped this third one, which is how
   * both the TypeScript and its SQL twin came to omit it.
   *
   * What is actually at stake if this regresses: on an ACCEPTED duel both
   * stakes are already debited (D5), `canDeleteDuel` refuses (D6),
   * `close_bet_early` refuses any duel, and `voidDuelsForDepartingMember`
   * skips mediators BY DESIGN — on the strength of this fallback existing. So
   * the resolver set would be empty forever and 2 × stake would sit in a
   * `closed` bet nothing can settle, with no error anywhere to say so. That is
   * the failure this test exists to make loud.
   */
  it("hands the moderator pool a duel whose NAMED MEDIATOR left the team (D7)", () => {
    const duel = fixtureDuel("b-duel-pending");
    // The premise, asserted so this cannot pass for the wrong reason: there is
    // no any-moderator pool on this row to fall back on by the ordinary arm.
    expect(duel.anyModerator).toBe(false);
    expect(duel.mediatorId).toBe(MEDIATOR);

    // While Vic is still on the roster, nothing changes — the pool stays shut.
    expect(canResolveDuel(duelTeam, MODERATOR, duel)).toBe(false);

    const withoutMediator: Team = {
      ...duelTeam,
      members: duelTeam.members.filter((m) => m.userId !== MEDIATOR),
    };

    // The moment Vic is gone, moderators and the leader can settle it.
    expect(canResolveDuel(withoutMediator, MODERATOR, duel)).toBe(true);
    // ...and the exclusions all still hold. The leader is the CHALLENGEE on
    // this duel, so A-1 does not let them judge their own bet even now — the
    // fallback opens the pool, it does not suspend D6.
    expect(canResolveDuel(withoutMediator, LEADER, duel)).toBe(false);
    expect(canResolveDuel(withoutMediator, CHALLENGEE, duel)).toBe(false); // challenger here
    expect(canResolveDuel(withoutMediator, CHALLENGER, duel)).toBe(false); // plain member
    expect(canResolveDuel(withoutMediator, STRANGER, duel)).toBe(false); // not a member
    // And the row is untouched: read-time fallback, never a stored
    // reassignment, so the history still names who was supposed to judge.
    expect(duel.mediatorId).toBe(MEDIATOR);
    expect(duel.anyModerator).toBe(false);
  });

  /**
   * The other half of the same rule, and the reason the fallback checks
   * `mediatorId !== null` rather than just "no mediator on the roster":
   * "nobody was named" must never read as "the named person left". A duel with
   * a null mediator is guaranteed `anyModerator: true` by SQL's
   * `bet_duels_has_a_resolver`, so it is admitted by the pool arm on its own
   * merits — and a member who is neither moderator nor leader is still refused
   * either way. Pinned because a fallback written as `!isMember(team,
   * duel.mediatorId!)` would be vacuously true on every null-mediator duel.
   */
  it("does not treat an unnamed mediator as a departed one", () => {
    const duel = fixtureDuel("b-duel-accepted");
    expect(duel.mediatorId).toBeNull();
    expect(duel.anyModerator).toBe(true);

    const emptied: Team = {
      ...duelTeam,
      members: duelTeam.members.filter((m) => m.userId !== MEDIATOR),
    };
    // Vic was never named here, so their absence changes nothing at all: the
    // pool arm admitted the moderator before and admits them now, and the
    // plain member is refused in both worlds.
    expect(canResolveDuel(emptied, MODERATOR, duel)).toBe(true);
    expect(canResolveDuel(duelTeam, MODERATOR, duel)).toBe(true);
    expect(canResolveDuel(duelTeam, CHALLENGEE, duel)).toBe(false);
  });
});

/**
 * PIN 8 — the four predicates every Extra Phase 3 surface gates on, and the
 * one property that makes them dangerous alone.
 *
 * These shipped with Extra Phase 2 and had no coverage until the surfaces
 * arrived, which is the wrong order but a fixable one. What is worth pinning
 * is not that they answer correctly — their bodies are four lines each — but
 * that they answer a DELIBERATELY INCOMPLETE question, and that a caller
 * cannot use one on its own.
 *
 * Every one of them is a roster+id rule. Not one looks at the clock, and none
 * ever will: an unaccepted duel past its deadline is expired, and knowing that
 * needs `bet.closesAt`, which is the bet's business and not the roster's. Both
 * `permissions.ts`'s header block and `state-machine.ts`'s call forgetting the
 * pairing "the single most likely bug in Extra Phase 3", and it presents as an
 * Accept button on a challenge that lapsed yesterday. The first `it` below is
 * that bug, written as an expectation, so that anyone who "fixes"
 * `canAcceptDuel` by teaching it the clock breaks a test that explains why not
 * — the clock belongs to `computeDuelPhase`, and duplicating it would give the
 * app two answers to one question.
 */
describe("canAcceptDuel / canDeclineDuel — the challengee's two moves (D5)", () => {
  it("admits only the challengee, and only while the duel is unanswered", () => {
    const duel = fixtureDuel("b-duel-pending");
    // b-duel-pending runs u-cg -> u-ld, so the leader is the one answering.
    expect(duel.challengeeId).toBe(LEADER);

    expect(canAcceptDuel(duelTeam, LEADER, duel)).toBe(true);
    // Not the challenger: they committed their stake at creation and cannot
    // accept on the other side.
    expect(canAcceptDuel(duelTeam, CHALLENGEE, duel)).toBe(false);
    // Not a moderator, and not the named mediator either — a duel is not a
    // team matter to arbitrate into existence.
    expect(canAcceptDuel(duelTeam, MODERATOR, duel)).toBe(false);
    expect(canAcceptDuel(duelTeam, MEDIATOR, duel)).toBe(false);
    expect(canAcceptDuel(duelTeam, STRANGER, duel)).toBe(false);

    // Already accepted: b-duel-accepted's challengee is also the leader, so
    // the only thing separating the two cases is the stored `acceptedAt`.
    const accepted = fixtureDuel("b-duel-accepted");
    expect(accepted.challengeeId).toBe(LEADER);
    expect(accepted.acceptedAt).not.toBeNull();
    expect(canAcceptDuel(duelTeam, LEADER, accepted)).toBe(false);
  });

  it("never consults the clock — which is why a surface must ask the phase too", () => {
    const bet = fixtureBet("b-duel-pending");
    const duel = fixtureDuel("b-duel-pending");
    const afterDeadline = Date.parse(bet.closesAt) + 1;

    // The challenge has lapsed on every reading that counts the clock...
    expect(computeDuelPhase(bet, duel, afterDeadline)).toBe("expired");
    // ...and the roster rule still says yes, because it was never asked about
    // time. A surface that renders Accept off this alone offers a button the
    // `accept_duel` RPC answers with "This challenge has expired."
    expect(canAcceptDuel(duelTeam, LEADER, duel)).toBe(true);
    expect(canDeclineDuel(duelTeam, LEADER, duel)).toBe(true);
  });

  it("keeps decline as its own body even though it agrees with accept today", () => {
    const duel = fixtureDuel("b-duel-pending");

    for (const userId of [LEADER, CHALLENGEE, MODERATOR, MEDIATOR, STRANGER]) {
      expect(canDeclineDuel(duelTeam, userId, duel), `decline by ${userId}`).toBe(
        canAcceptDuel(duelTeam, userId, duel),
      );
    }

    // They are not the same question, and the day they diverge is already
    // named: accepting has a money precondition (DOM-014 is absolute) that
    // declining never will, because the broke challengee's ONLY legal move IS
    // to decline, carrying `void_reason='insufficient-funds'`. An alias here
    // would trap that person with no action at all the moment a balance check
    // joined accept. This loop asserts today's agreement; the two bodies are
    // what keep tomorrow's divergence from being silent.
    expect(canDeclineDuel).not.toBe(canAcceptDuel);
  });
});

/**
 * PIN 9 — D6's deletion rule, the half that only duels have.
 *
 * Deletion keeps the ordinary `canDeleteBet` set — creator or moderator, with
 * the leader inheriting via A-1 — and adds one condition: not yet accepted.
 * Once both stakes are down, deleting is the challenger's escape hatch from a
 * bet they are losing, so after acceptance the only honest exits are a
 * resolution or a void, both of which move money through `app.settle_bet` and
 * leave a history row.
 */
describe("canDeleteDuel — creator-or-moderator, and only before acceptance (D6)", () => {
  it("lets the challenger cancel their own unanswered challenge", () => {
    const bet = fixtureBet("b-duel-pending");
    const duel = fixtureDuel("b-duel-pending");

    // The challenger is also the bet's creator — `create_duel` inserts the
    // `bets` row on their behalf — so `canDeleteBet` already admits them.
    expect(bet.creatorId).toBe(duel.challengerId);
    expect(canDeleteDuel(duelTeam, CHALLENGEE, bet, duel)).toBe(true);
    // And a moderator who is nobody in this duel can too, exactly as on a
    // pool bet.
    expect(canDeleteDuel(duelTeam, MODERATOR, bet, duel)).toBe(true);
    // The challengee is not admitted BY BEING THE CHALLENGEE — but this one
    // is also the leader, and A-1 gives the leader every moderator power, so
    // they are admitted the same way any other moderator is. Pinning it here
    // because it looks wrong at a glance and is not: D6 kept the ordinary
    // creator-or-moderator set and added exactly ONE condition to it, the
    // unaccepted guard. Nothing is at risk either way — `delete_bet` runs
    // `app.reverse_bet_effects` and hands the challenger their stake back, the
    // same coins `decline_duel` would return. All that differs is the history
    // row: a delete leaves none, a decline leaves `VOID · DECLINED`.
    expect(canDeleteDuel(duelTeam, LEADER, bet, duel)).toBe(true);
    // The plain-member challengee of a duel they did not create is the case
    // that really is refused, and the mediator likewise.
    const asMember = teamAs({
      leaderId: MODERATOR,
      members: duelTeam.members.map((m) =>
        m.userId === LEADER ? { ...m, role: "member" as const } : m,
      ),
    });
    expect(canDeleteDuel(asMember, LEADER, bet, duel)).toBe(false);
    expect(canDeleteDuel(duelTeam, MEDIATOR, bet, duel)).toBe(false);
  });

  it("refuses an accepted duel to everyone, the leader included", () => {
    const bet = fixtureBet("b-duel-accepted");
    const duel = fixtureDuel("b-duel-accepted");

    expect(duel.acceptedAt).not.toBeNull();
    for (const userId of [CHALLENGER, LEADER, MODERATOR, MEDIATOR]) {
      expect(canDeleteDuel(duelTeam, userId, bet, duel), `delete by ${userId}`).toBe(
        false,
      );
    }
    // Guard: the refusal has to come from the acceptance, not from the roster
    // rule quietly saying no to all four anyway. The moderator IS admitted by
    // the underlying `canDeleteBet` on the same bet.
    expect(canDeleteDuel(duelTeam, MODERATOR, bet, { ...duel, acceptedAt: null })).toBe(
      true,
    );
  });
});

/**
 * PIN 10 — `validateDuelDraft`, the compose form's submit gate.
 *
 * `create_duel` re-checks every rule here and repeats every sentence
 * byte-for-byte; this copy exists so a person sees the rule before a round
 * trip, never as the enforcement. The cases below are the ones the form can
 * actually produce.
 *
 * The last `it` is the important one and it is a NEGATIVE: D9 is deliberately
 * not enforced here. In a restricted team a draft with `anyModerator: false`
 * is perfectly valid and `create_duel` silently stores `true` instead —
 * coercion, not refusal — so the challenger never sees an error for a control
 * the UI had already ticked and disabled on their behalf. An issue code added
 * here would surface exactly that error.
 */
describe("validateDuelDraft — the compose form's gate, and the rule it must NOT have (D9)", () => {
  const context = { team: duelTeam, challengerId: CHALLENGER, balance: 535 };
  // Annotated rather than inferred: without it `mediatorId` widens to `string`
  // and the `{ mediatorId: null }` case below — the whole point of the field
  // being nullable — stops type-checking.
  const goodDraft: DuelDraft = {
    title: "Caio vs Nina, one more time",
    challengeeId: CHALLENGEE,
    mediatorId: MEDIATOR,
    anyModerator: false,
    stake: 25,
  };

  it("passes a well-formed challenge", () => {
    expect(validateDuelDraft(goodDraft, context)).toEqual([]);
  });

  // Codes, not sentences (plan-i18n-ptbr.md D8): `ValidationIssue.message` is
  // gone, so what this pins is the mapping from a broken rule to the key the
  // UI looks up in `messages/*.json`. That is the mapping worth pinning — the
  // sentence is now free to change in either language without touching a test,
  // which is exactly the property the owner asked for.
  it("reports one issue per broken rule, as a code", () => {
    const cases: [Partial<DuelDraft>, ValidationCode][] = [
      [{ title: "   " }, "title-required"],
      [{ challengeeId: "" }, "duel-target-required"],
      [{ challengeeId: CHALLENGER }, "duel-target-self"],
      [{ challengeeId: STRANGER }, "duel-target-required"],
      [{ mediatorId: CHALLENGEE }, "duel-mediator-invalid"],
      [{ mediatorId: null, anyModerator: false }, "duel-resolver-required"],
      [{ stake: 0 }, "duel-stake-invalid"],
      [{ stake: 536 }, "duel-stake-invalid"],
      [{ stake: 2.5 }, "duel-stake-invalid"],
    ];

    for (const [override, code] of cases) {
      const issues = validateDuelDraft({ ...goodDraft, ...override }, context);
      expect(issues, `${code} for ${JSON.stringify(override)}`).toEqual([
        { code },
      ]);
    }
  });

  it("accepts a stake equal to the whole balance but not a coin more", () => {
    expect(validateDuelDraft({ ...goodDraft, stake: 535 }, context)).toEqual([]);
    expect(
      validateDuelDraft({ ...goodDraft, stake: 536 }, context),
    ).toHaveLength(1);
  });

  it("never consults team.accessMode — D9 lives in create_duel, not here", () => {
    const restricted = teamAs({ accessMode: "restricted" });

    // The invariant, stated as the one thing that can be measured about a
    // function's refusal to look at a field: every draft validates IDENTICALLY
    // under both access modes. `validateDuelDraft`'s own doc comment forbids
    // reading `team.accessMode` at length, and this loop is what makes that
    // paragraph enforceable.
    const drafts = [
      goodDraft,
      { ...goodDraft, mediatorId: null, anyModerator: true },
      { ...goodDraft, mediatorId: null, anyModerator: false },
      { ...goodDraft, challengeeId: CHALLENGER },
      { ...goodDraft, stake: 9999 },
    ];
    for (const draft of drafts) {
      expect(
        validateDuelDraft(draft, { ...context, team: restricted }),
        `restricted vs free-for-all: ${JSON.stringify(draft)}`,
      ).toEqual(validateDuelDraft(draft, context));
    }

    // Which leaves a real gap between this gate and `create_duel`'s, and it is
    // worth naming rather than discovering. Server-side the resolver check
    // runs against the COERCED value, so `{mediatorId: null, anyModerator:
    // false}` in a restricted team is ACCEPTED and stored as `true`. Here it
    // is refused, because from this function's point of view the draft names
    // no possible resolver:
    expect(
      validateDuelDraft(
        { ...goodDraft, mediatorId: null, anyModerator: false },
        { ...context, team: restricted },
      ),
    ).toEqual([{ code: "duel-resolver-required" }]);

    // The gap is unreachable from the UI and that is `mustForceAnyModerator`'s
    // entire job: the compose form renders the control ticked and disabled in
    // a restricted team and validates + submits the EFFECTIVE value, so a
    // draft carrying `false` never leaves it. D9 stays a coercion the
    // challenger never sees, which was the point — the alternative is an error
    // message about a control they were not allowed to touch.
    expect(mustForceAnyModerator(restricted)).toBe(true);
    expect(
      validateDuelDraft(
        { ...goodDraft, mediatorId: null, anyModerator: mustForceAnyModerator(restricted) },
        { ...context, team: restricted },
      ),
    ).toEqual([]);
  });
});

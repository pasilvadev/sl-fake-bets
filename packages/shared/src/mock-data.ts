/**
 * Deterministic hand-written mock data for Phase 1 (ARC-010):
 * one fake team, fake users, bets in every lifecycle state with pari-mutuel
 * pools, wagers, and comments. No database, no randomness, no faker.
 *
 * Extra Phase 2 added two duels (`mockDuels`) and their bets, wagers and
 * balance effects. They are the only rows in this file whose meaning depends
 * on a clock the fixture cannot freeze; the comment on b-08 explains what that
 * costs here and why supabase/seed.sql — the one a running app actually
 * reads — pays it differently.
 */

import { CONFIG, DEFAULT_MAX_WAGER } from "./config";
import type { Bet, Comment, Duel, Team, Transaction, User, Wager } from "./types";

/**
 * nameColor values = the 10 curated name colors (design-visual-identity.md §2.4).
 *
 * `locale` is appended rather than typed on each row: every mock user is
 * deliberately "never chose" (UX-027, D3), so ten identical `locale: null`
 * entries would be ten columns of noise in a table that reads as a table.
 * A fixture user who HAD chosen would be making a claim about behaviour this
 * fixture does not exercise.
 */
const MOCK_USER_ROWS = [
  { id: "u-01", displayName: "Rafa", nameColor: "#2C9297", avatar: "icon-dice" },
  { id: "u-02", displayName: "Duds", nameColor: "#2C91AA", avatar: "icon-crown" },
  { id: "u-03", displayName: "Pri", nameColor: "#2B8DBF", avatar: "icon-ghost" },
  { id: "u-04", displayName: "Tomate", nameColor: "#2D88EC", avatar: "icon-flame" },
  { id: "u-05", displayName: "Careca", nameColor: "#647BF1", avatar: "icon-bolt" },
  { id: "u-06", displayName: "Nina", nameColor: "#8C70F2", avatar: "icon-star" },
  { id: "u-07", displayName: "Guiz", nameColor: "#B45CF5", avatar: "icon-skull" },
  { id: "u-08", displayName: "Lelê", nameColor: "#DB36E3", avatar: "icon-moon" },
  { id: "u-09", displayName: "Pinto", nameColor: "#EC35B3", avatar: "icon-fish" },
  { id: "u-10", displayName: "Xis", nameColor: "#F33483", avatar: "icon-target" },
];

export const mockUsers: User[] = MOCK_USER_ROWS.map((row) => ({
  ...row,
  locale: null,
}));

/**
 * t-01 member numbers are DERIVED, not hand-typed (settlement regression in
 * settlement.test.ts pins them): stakes leave the balance at placement, so
 * coinBalance = ledger credits (grant/rewards/injection) − stakes still in
 * flight (open/closed bets) + resolved payouts/refunds, and profitLoss is the
 * realized outcome of the resolved bets only (b-05 winner, b-06 void).
 *
 * That formula is Phase 7's consistency guard verbatim
 * (apps/web/src/lib/data/consistency-guard.ts), which is why it is worth
 * re-reading before touching a single number here: the guard does not care
 * that a stake happens to belong to a DUEL. A duel wager is a `Wager` row like
 * any other, so the two duels added in Extra Phase 2 move three of the ten
 * balances below — u-06, u-07 and u-09 — and each of those lines says by how
 * much and why. u-08, who has been challenged but has not answered, is
 * deliberately UNCHANGED: money moves twice and never on credit (D5).
 *
 * The Phase 1 standing note governs any disagreement found here: if these
 * hand-typed numbers stop reconciling, fix the fixtures, not the pure
 * functions. `settleBet` pins Phases 1 through 7.
 */
export const mockTeam: Team = {
  id: "t-01",
  name: "SL Originals",
  leaderId: "u-01",
  accessMode: "free-for-all",
  // Two links (D7, plan-invite-links.md): the permanent one every team is
  // born with (D9 — unchanged since Phase 1) plus one 24-hour demo link, so
  // this fixture exercises both kinds the way supabase/seed.sql's matching
  // rows do for a running app. Fixed dates throughout — unlike the seed's
  // `now()`-relative twin (Phase 1 task 11), every test here injects its own
  // `now`, so a link that would already have died by the time someone reads
  // this file is exactly the point: `duel-club`-style fixtures pin behaviour,
  // they do not need to still be "live" by wall-clock time.
  invites: [
    {
      id: "70000000-0000-4000-a000-000000000001",
      code: "sl-originals-4ever",
      createdBy: "u-01",
      createdAt: "2026-08-01T18:00:00Z",
      expiresAt: null,
    },
    {
      id: "70000000-0000-4000-a000-000000000004",
      code: "originals-day-pass",
      createdBy: "u-02",
      createdAt: "2026-08-01T18:00:00Z",
      expiresAt: "2026-08-02T18:00:00Z",
    },
  ],
  bannedUserIds: [],
  createdAt: "2026-08-01T18:00:00Z",
  members: [
    { userId: "u-01", role: "member", coinBalance: 45, profitLoss: -15, joinedAt: "2026-08-01T18:00:00Z" },
    { userId: "u-02", role: "moderator", coinBalance: 110, profitLoss: 50, joinedAt: "2026-08-01T18:05:00Z" },
    { userId: "u-03", role: "moderator", coinBalance: 80, profitLoss: 0, joinedAt: "2026-08-01T19:12:00Z" },
    { userId: "u-04", role: "member", coinBalance: 30, profitLoss: -60, joinedAt: "2026-08-02T10:30:00Z" },
    { userId: "u-05", role: "member", coinBalance: 90, profitLoss: 0, joinedAt: "2026-08-02T11:00:00Z" },
    // 105 − 40 (w-20). Nina's stake on b-08 left the moment she SENT the
    // challenge, while it is still unaccepted and could yet be declined, left
    // to expire, or cascaded away by someone leaving the team. The coins are
    // simply gone until one of those returns them (D5: no escrow account, no
    // held-balance column — a void refunds through `settleBet`'s ordinary
    // refund branch, exactly as `reverseBet` already returns stakes).
    { userId: "u-06", role: "member", coinBalance: 65, profitLoss: 25, joinedAt: "2026-08-03T14:45:00Z" },
    // 60 − 25 (w-18): Guiz's own stake on b-07, gone at challenge time.
    { userId: "u-07", role: "member", coinBalance: 35, profitLoss: 0, joinedAt: "2026-08-05T09:20:00Z" },
    // UNCHANGED at 65, and it is the pair to u-06 four lines up that makes
    // this the interesting row: Lelê has been challenged on b-08 and has not
    // accepted, so not one coin of his has moved. Halving a duel's pool
    // between "sent" and "accepted" is the single most likely thing to get
    // wrong when re-deriving these numbers — the symmetry of the stake tempts
    // you to debit both sides at once — so the asymmetry is written down here
    // rather than left to be rediscovered by a guard warning.
    { userId: "u-08", role: "member", coinBalance: 65, profitLoss: 0, joinedAt: "2026-08-07T21:10:00Z" },
    // 100 − 25 (w-19): Pinto's stake left on ACCEPT, not on challenge — the
    // second of D5's two movements, and the reason b-07 has a two-sided pool
    // while b-08 has a one-sided one.
    { userId: "u-09", role: "member", coinBalance: 75, profitLoss: 0, joinedAt: "2026-08-10T16:40:00Z" },
    // Newest member: grant minus the 20 still in flight on b-02 (w-07).
    { userId: "u-10", role: "member", coinBalance: CONFIG.ONBOARDING_GRANT_COINS - 20, profitLoss: 0, joinedAt: "2026-09-01T12:00:00Z" },
  ],
};

/**
 * The signed-in user for Phase 1 mocks (UX-011 lands straight on the dashboard).
 * u-01 (Rafa) is the team leader, so leader-only UI (coin injection, team
 * settings) is exercised by default.
 */
export const mockCurrentUserId = "u-01";

/**
 * Extra teams the current user belongs to, so the team switcher (UX-009/010)
 * renders a real multi-team state. Only mockTeam has bets/wagers/comments;
 * the others exist to populate the switcher.
 *
 * Because they have no bets, their balances are their ledger and nothing else
 * (the grants and rewards in `mockTransactions`) and their profitLoss is 0 —
 * DOM-026 P/L is the realized outcome of resolved bets, and there are none
 * here to realize. Kept in step with supabase/seed.sql, whose copy of these
 * rows Phase 7's consistency guard checks.
 */
export const mockTeams: Team[] = [
  mockTeam,
  {
    id: "t-02",
    name: "Lanhouse Legends",
    leaderId: "u-02",
    accessMode: "restricted",
    invites: [
      {
        id: "70000000-0000-4000-a000-000000000002",
        code: "lanhouse-legends-gg",
        createdBy: "u-02",
        createdAt: "2026-07-15T20:00:00Z",
        expiresAt: null,
      },
    ],
    bannedUserIds: [],
    createdAt: "2026-07-15T20:00:00Z",
    members: [
      { userId: "u-02", role: "member", coinBalance: 110, profitLoss: 0, joinedAt: "2026-07-15T20:00:00Z" },
      { userId: "u-01", role: "moderator", coinBalance: 100, profitLoss: 0, joinedAt: "2026-07-15T20:10:00Z" },
      { userId: "u-07", role: "member", coinBalance: 105, profitLoss: 0, joinedAt: "2026-07-16T10:00:00Z" },
    ],
  },
  {
    id: "t-03",
    name: "Churrasco FC",
    leaderId: "u-05",
    accessMode: "free-for-all",
    invites: [
      {
        id: "70000000-0000-4000-a000-000000000003",
        code: "churrasco-fc-2026",
        createdBy: "u-05",
        createdAt: "2026-08-20T12:00:00Z",
        expiresAt: null,
      },
    ],
    bannedUserIds: [],
    createdAt: "2026-08-20T12:00:00Z",
    members: [
      { userId: "u-05", role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-08-20T12:00:00Z" },
      { userId: "u-01", role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-08-21T09:00:00Z" },
    ],
  },
];

/**
 * Six pool bets covering every lifecycle state (ARC-010), then the two duels
 * Extra Phase 2 added — whose duel halves live in `mockDuels` below.
 *
 * Every entry carries an explicit `kind`, the six that predate the field
 * included, and that is deliberate rather than tedious. `Bet.kind` is REQUIRED
 * (types.ts argues the case at length), so the compiler is what stops a future
 * fixture from quietly inheriting `"pool"` and rendering a duel as an ordinary
 * pari-mutuel bet that somebody can then wager into. The database gets the same
 * guarantee for free from `bets.kind not null default 'pool'`; a TypeScript
 * literal has no default to inherit, so it is spelled out per row.
 */
export const mockBets: Bet[] = [
  {
    id: "b-01",
    teamId: "t-01",
    creatorId: "u-02",
    title: "Careca chega atrasado no churrasco de sábado?",
    iconEmoji: "🍖",
    options: [
      { id: "b-01-o1", label: "Yes, as always" },
      { id: "b-01-o2", label: "No, miracle happens" },
    ],
    state: "open",
    closesAt: "2026-09-05T14:00:00Z",
    maxWagerPerUser: DEFAULT_MAX_WAGER,
    kind: "pool",
    createdAt: "2026-09-02T20:00:00Z",
  },
  {
    id: "b-02",
    teamId: "t-01",
    creatorId: "u-01",
    title: "Quantos gols o time do Guiz toma no domingo?",
    iconEmoji: "⚽",
    options: [
      { id: "b-02-o1", label: "0–1" },
      { id: "b-02-o2", label: "2–3" },
      { id: "b-02-o3", label: "4+" },
    ],
    state: "open",
    closesAt: "2026-09-06T15:00:00Z",
    maxWagerPerUser: 50,
    kind: "pool",
    createdAt: "2026-09-03T09:30:00Z",
  },
  {
    id: "b-03",
    teamId: "t-01",
    creatorId: "u-03",
    title: "Nina termina a maratona de One Piece antes de outubro?",
    iconEmoji: "🏴‍☠️",
    options: [
      { id: "b-03-o1", label: "Yes" },
      { id: "b-03-o2", label: "No chance" },
    ],
    state: "open",
    closesAt: "2026-09-30T23:59:00Z",
    maxWagerPerUser: DEFAULT_MAX_WAGER,
    kind: "pool",
    createdAt: "2026-08-28T22:15:00Z",
  },
  {
    id: "b-04",
    teamId: "t-01",
    creatorId: "u-06",
    title: "Pinto fica sem bateria no meio da call de novo?",
    iconEmoji: "🔋",
    options: [
      { id: "b-04-o1", label: "Yes" },
      { id: "b-04-o2", label: "No" },
    ],
    state: "closed",
    closesAt: "2026-09-03T19:00:00Z",
    maxWagerPerUser: 25,
    kind: "pool",
    createdAt: "2026-09-01T18:00:00Z",
  },
  {
    id: "b-05",
    teamId: "t-01",
    creatorId: "u-02",
    title: "Tomate ganha a ranqueada até sexta?",
    iconEmoji: "🎮",
    options: [
      { id: "b-05-o1", label: "Wins" },
      { id: "b-05-o2", label: "Loses" },
    ],
    state: "resolved",
    closesAt: "2026-08-28T18:00:00Z",
    maxWagerPerUser: DEFAULT_MAX_WAGER,
    resolution: { kind: "winner", winningOptionId: "b-05-o2" },
    kind: "pool",
    createdAt: "2026-08-25T12:00:00Z",
  },
  {
    id: "b-06",
    teamId: "t-01",
    creatorId: "u-05",
    title: "Chove no rolê de quinta?",
    iconEmoji: "🌧️",
    options: [
      { id: "b-06-o1", label: "Rain" },
      { id: "b-06-o2", label: "Dry" },
    ],
    state: "resolved",
    closesAt: "2026-08-27T17:00:00Z",
    maxWagerPerUser: 30,
    // No `reason`, and it must stay that way: D3 added `BetVoidReason` with a
    // nullable column and no backfill, so every void written before Extra
    // Phase 2 legitimately has none. `undefined` here means "voided, reason
    // not recorded" — never "voided for some other reason" — and this fixture
    // is the one that keeps that case exercised.
    resolution: { kind: "void" },
    kind: "pool",
    createdAt: "2026-08-26T08:00:00Z",
  },

  // --- duels (Extra Phase 2) --------------------------------------------------
  // Both are still ordinary `Bet` rows in every respect, and that IS D1: a duel
  // is a KIND, not a fourth `BetState`, so `closesAt`, `maxWagerPerUser`,
  // `computeEffectiveState`, the countdown and UX-008's feed sort all keep
  // working on them with no special case. What makes them duels is `kind`
  // plus a row in `mockDuels`; nothing else on this shape changes.
  //
  // Neither is RESOLVED, and that is load-bearing rather than incidental.
  // settlement.test.ts asserts that the resolved fixtures are exactly b-05 and
  // b-06, because the pinned pari-mutuel arithmetic of those two IS Phase 1's
  // settlement regression, and a third resolved bet would silently change what
  // "every resolved fixture" means to it. A settled duel belongs in
  // duel.test.ts, constructed there for the case it proves, not smuggled into
  // the shared world every other suite reads.
  {
    id: "b-07",
    teamId: "t-01",
    // creatorId === Duel.challengerId, on every duel, always: `create_duel`
    // inserts the bet under the challenger and there is no other write path
    // that produces a `kind='duel'` row. Anywhere the two disagree is a bug,
    // not a variant worth supporting.
    creatorId: "u-07",
    title: "1v1 no FIFA: o Guiz passa o Pinto?",
    iconEmoji: "🕹️",
    // Auto-generated by `create_duel` from the two participants' displayName,
    // position 0 = challenger, position 1 = challengee. Not free text and not
    // the challenger's to choose: a duel has exactly two outcomes and they are
    // the two people in it. That is also why `settleBet` needs nothing new —
    // two options, two symmetric stakes, one of them wins the pool.
    options: [
      { id: "b-07-o1", label: "Guiz" },
      { id: "b-07-o2", label: "Pinto" },
    ],
    // ACCEPTED. Accepting does exactly what `close_bet_early` already does
    // (D2) — `state: "closed"` plus `closesAt` overwritten to the instant of
    // acceptance — which lands the duel in the AWAITING RESULT treatment the
    // design system already specifies, with no new state anywhere. It is also
    // why this `closesAt` is EARLIER than the duel's `expiresAt` rather than
    // equal to it; `mockDuels` below spells that divergence out.
    state: "closed",
    closesAt: "2026-09-04T20:30:00Z",
    // Equal to the stake, on every duel, always (task 6). Not a creator
    // preference here but the structural guarantee that a third wager is
    // impossible even if a write path ever leaked — which is the cheap half of
    // why duels need no settlement code of their own.
    maxWagerPerUser: 25,
    kind: "duel",
    createdAt: "2026-09-04T19:00:00Z",
  },
  {
    id: "b-08",
    teamId: "t-01",
    creatorId: "u-06",
    title: "1v1 de sinuca no sábado: Nina ou Lelê?",
    iconEmoji: "🎱",
    options: [
      { id: "b-08-o1", label: "Nina" },
      { id: "b-08-o2", label: "Lelê" },
    ],
    // PENDING: still `open`, and `closesAt` is the accept deadline itself —
    // createdAt + CONFIG.DUEL_ACCEPT_WINDOW_HOURS, to the minute. D2's whole
    // trick is that the EXISTING clock carries "waiting to be accepted", so
    // there is no fourth state to add and `enforce_bet_state_transition` stays
    // byte-for-byte unchanged.
    //
    // These two timestamps are frozen in the fixture's own early-September
    // present, exactly as b-01's and b-02's are, so against a real `Date.now()`
    // `computeDuelPhase` reports "expired" rather than "pending". Do not
    // "fix" that by pushing the date into the future: it is the same staleness
    // `computeEffectiveState` has always reported for b-01, this module is
    // Phase 1's frozen world (ARC-010), and nothing has rendered from it since
    // the app started reading Postgres in Phase 4. A test that cares about the
    // phase passes its own `nowMs`, which is exactly why `computeDuelPhase`
    // takes one instead of calling `Date.now()` itself. supabase/seed.sql —
    // which a running stack really does read, and where a stale pending duel
    // would make `app.expire_stale_duels` move money on first load — solves the
    // same problem the opposite way, and argues it there.
    state: "open",
    closesAt: "2026-09-06T18:00:00Z",
    maxWagerPerUser: 40,
    kind: "duel",
    createdAt: "2026-09-05T18:00:00Z",
  },
];

/**
 * The duel halves of the two `kind: "duel"` bets above (Extra Phase 2, D1) —
 * the fixture twin of `public.bet_duels`, which is 1:1 with `bets` by primary
 * key and joined here on `betId`. Nothing in this list repeats what the `Bet`
 * already says: no title, no state, no `teamId`. A duel reaches its team
 * through its bet, the way a `Comment` does and unlike a `ChatMessage`, which
 * carries one — and that absence is what makes the realtime binding on
 * `bet_duels` unfilterable by team and reliant on RLS instead.
 *
 * Two rows rather than two of the same shape, because between them they cover
 * both resolver arms D7 allows:
 *
 *  - b-07 names a mediator (Pri, u-03) and leaves `anyModerator` false. Pri
 *    happens to be a moderator of t-01, but only incidentally: the named
 *    mediator may be ANY teammate who is not one of the two participants, and
 *    no role is consulted. This is the pair that exercises `canResolveDuel`'s
 *    first arm and, in SQL, the left half of `bet_duels_has_a_resolver`.
 *  - b-08 names nobody and sets `anyModerator` true — the pool arm, the CHECK's
 *    right half, and the shape D9 forces onto every duel created inside a
 *    `restricted` team. t-01 is `free-for-all`, so this one CHOSE it; it was
 *    not coerced. There is deliberately no fixture for the coercion itself,
 *    because there is nothing to fixture: it happens inside `create_duel` and
 *    the stored row is identical either way. That is precisely D9's "enforced
 *    at creation, never retroactively" — you cannot tell from a row which team
 *    setting produced it, and no later read is supposed to be able to.
 *
 * `expiresAt` against the bet's `closesAt` is the other thing these two are
 * here to show. They are EQUAL on b-08, still pending, where the accept
 * deadline is still the bet's deadline; they DIVERGE on b-07, where accepting
 * overwrote `closesAt` to the moment of acceptance (D2) while `expiresAt` kept
 * the deadline the challenge originally carried. That divergence is the entire
 * reason the field is stored rather than derived from the bet, and b-07 exists
 * partly so the next reader can see it instead of taking the doc comment's
 * word for it.
 *
 * No `mockDuels` entry describes money. It cannot: by the time a row exists
 * here the coins have already left, as ordinary `Wager` rows (w-18/w-19 for
 * b-07, w-20 alone for b-08). There is no escrow field on `Duel` and there
 * must not be one.
 */
export const mockDuels: Duel[] = [
  {
    betId: "b-07",
    challengerId: "u-07",
    challengeeId: "u-09",
    mediatorId: "u-03",
    anyModerator: false,
    stake: 25,
    acceptedAt: "2026-09-04T20:30:00Z",
    // createdAt + 24h. Kept from creation even though the bet's own closesAt
    // has since been rewritten to the acceptance instant — see above.
    expiresAt: "2026-09-05T19:00:00Z",
  },
  {
    betId: "b-08",
    challengerId: "u-06",
    challengeeId: "u-08",
    mediatorId: null,
    anyModerator: true,
    stake: 40,
    acceptedAt: null,
    // Equal to b-08.closesAt, because nothing has accepted it yet.
    expiresAt: "2026-09-06T18:00:00Z",
  },
];

export const mockWagers: Wager[] = [
  // b-01 (open): pool 85
  { id: "w-01", betId: "b-01", userId: "u-01", optionId: "b-01-o1", amount: 30, placedAt: "2026-09-02T20:10:00Z" },
  { id: "w-02", betId: "b-01", userId: "u-03", optionId: "b-01-o1", amount: 20, placedAt: "2026-09-02T21:00:00Z" },
  { id: "w-03", betId: "b-01", userId: "u-06", optionId: "b-01-o2", amount: 25, placedAt: "2026-09-03T10:05:00Z" },
  { id: "w-04", betId: "b-01", userId: "u-05", optionId: "b-01-o1", amount: 10, placedAt: "2026-09-03T11:30:00Z" },
  // b-02 (open): pool 95
  { id: "w-05", betId: "b-02", userId: "u-07", optionId: "b-02-o2", amount: 40, placedAt: "2026-09-03T10:00:00Z" },
  { id: "w-06", betId: "b-02", userId: "u-08", optionId: "b-02-o3", amount: 35, placedAt: "2026-09-03T12:20:00Z" },
  { id: "w-07", betId: "b-02", userId: "u-10", optionId: "b-02-o1", amount: 20, placedAt: "2026-09-03T18:45:00Z" },
  // b-03 (open): pool 60
  { id: "w-08", betId: "b-03", userId: "u-02", optionId: "b-03-o2", amount: 50, placedAt: "2026-08-29T09:00:00Z" },
  { id: "w-09", betId: "b-03", userId: "u-04", optionId: "b-03-o1", amount: 10, placedAt: "2026-08-30T15:30:00Z" },
  // b-04 (closed): pool 45
  { id: "w-10", betId: "b-04", userId: "u-01", optionId: "b-04-o1", amount: 25, placedAt: "2026-09-01T18:30:00Z" },
  { id: "w-11", betId: "b-04", userId: "u-09", optionId: "b-04-o2", amount: 20, placedAt: "2026-09-02T09:10:00Z" },
  // b-05 (resolved, winner b-05-o2): pool 135 — u-01 loses, so the current
  // user's own "\ LOST" outcome glyph renders on the dashboard (§5.2).
  { id: "w-17", betId: "b-05", userId: "u-01", optionId: "b-05-o1", amount: 15, placedAt: "2026-08-25T12:30:00Z" },
  { id: "w-12", betId: "b-05", userId: "u-04", optionId: "b-05-o1", amount: 60, placedAt: "2026-08-25T13:00:00Z" },
  { id: "w-13", betId: "b-05", userId: "u-02", optionId: "b-05-o2", amount: 40, placedAt: "2026-08-25T14:20:00Z" },
  { id: "w-14", betId: "b-05", userId: "u-06", optionId: "b-05-o2", amount: 20, placedAt: "2026-08-26T10:00:00Z" },
  // b-06 (resolved void, wagers refunded): pool 50
  { id: "w-15", betId: "b-06", userId: "u-05", optionId: "b-06-o1", amount: 30, placedAt: "2026-08-26T08:30:00Z" },
  { id: "w-16", betId: "b-06", userId: "u-08", optionId: "b-06-o2", amount: 20, placedAt: "2026-08-26T09:15:00Z" },
  // b-07 (duel, accepted): pool 50 — 25 a side, and structurally never more,
  // because the bet's maxWagerPerUser IS the stake. There is no third wager to
  // write here and no path that could produce one: `place_wager` refuses
  // `kind='duel'` outright, and `wagers` INSERT has been revoked from
  // `authenticated` since Phase 6, so the RPC is the only door. Two symmetric
  // stakes are exactly what makes `settleBet` pay a flat 2.00x each side with
  // no duel-specific formula anywhere — task 6 is a proof, not an
  // implementation, and these two rows are the fixture it is proved against.
  //
  // Note the placedAt values: the challenger's is the bet's own createdAt (the
  // stake leaves in the same transaction that writes the bet), the
  // challengee's is the acceptance instant. D5's two movements, visible.
  { id: "w-18", betId: "b-07", userId: "u-07", optionId: "b-07-o1", amount: 25, placedAt: "2026-09-04T19:00:00Z" },
  { id: "w-19", betId: "b-07", userId: "u-09", optionId: "b-07-o2", amount: 25, placedAt: "2026-09-04T20:30:00Z" },
  // b-08 (duel, pending): pool 40 — ONE wager, and the asymmetry is the point.
  // The challengee's half does not exist until they accept. Adding a second
  // row here to make the fixture look tidy would put 40 coins into a pool that
  // never left anybody's balance, and Phase 7's consistency guard would report
  // it as drift against u-08 the first time anyone loaded the team — which is
  // the guard working, not the guard being wrong.
  { id: "w-20", betId: "b-08", userId: "u-06", optionId: "b-08-o1", amount: 40, placedAt: "2026-09-05T18:00:00Z" },
];

export const mockComments: Comment[] = [
  { id: "c-01", betId: "b-01", userId: "u-04", body: "Easy money, ele NUNCA chegou no horário", createdAt: "2026-09-02T20:15:00Z" },
  { id: "c-02", betId: "b-01", userId: "u-05", body: "dessa vez eu chego, confia", createdAt: "2026-09-02T20:22:00Z" },
  { id: "c-03", betId: "b-01", userId: "u-06", body: "apostando no milagre só pela odd", createdAt: "2026-09-03T10:06:00Z" },
  { id: "c-04", betId: "b-02", userId: "u-07", body: "meu time é ruim mas não TÃO ruim", createdAt: "2026-09-03T10:05:00Z" },
  { id: "c-05", betId: "b-02", userId: "u-08", body: "4+ fácil, zagueiro tá lesionado", createdAt: "2026-09-03T12:22:00Z" },
  { id: "c-06", betId: "b-03", userId: "u-06", body: "tô no episódio 400 já, relaxa", createdAt: "2026-08-29T10:00:00Z" },
  { id: "c-07", betId: "b-03", userId: "u-02", body: "400 de 1100+... boa sorte", createdAt: "2026-08-29T10:30:00Z" },
  { id: "c-08", betId: "b-05", userId: "u-02", body: "GG, pagou 2x", createdAt: "2026-08-28T19:00:00Z" },
  { id: "c-09", betId: "b-06", userId: "u-05", body: "nem choveu nem fez sol, anulada justa", createdAt: "2026-08-27T18:00:00Z" },
];

/**
 * Coin-ledger mock (DOM-025): t-01's complete transfer ledger — one onboarding
 * grant per membership (decision §4.2), daily rewards for the members who
 * logged in on those days (lazy grant, decision §4.3), and one leader
 * injection. balanceAfter snapshots interleave with wager stakes/payouts,
 * which are deliberately NOT ledger rows (DOM-026, decision §4.6).
 */
export const mockTransactions: Transaction[] = [
  // Onboarding grants, one per membership, at join time (DOM-021).
  { id: "tx-01", teamId: "t-01", userId: "u-01", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-01T18:00:00Z" },
  { id: "tx-02", teamId: "t-01", userId: "u-02", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-01T18:05:00Z" },
  { id: "tx-03", teamId: "t-01", userId: "u-03", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-01T19:12:00Z" },
  { id: "tx-04", teamId: "t-01", userId: "u-04", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-02T10:30:00Z" },
  { id: "tx-05", teamId: "t-01", userId: "u-05", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-02T11:00:00Z" },
  { id: "tx-06", teamId: "t-01", userId: "u-06", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-03T14:45:00Z" },
  { id: "tx-07", teamId: "t-01", userId: "u-07", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-05T09:20:00Z" },
  { id: "tx-08", teamId: "t-01", userId: "u-08", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-07T21:10:00Z" },
  { id: "tx-09", teamId: "t-01", userId: "u-09", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-10T16:40:00Z" },
  { id: "tx-10", teamId: "t-01", userId: "u-10", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-09-01T12:00:00Z" },
  // Daily rewards + injection, chronological. u-01's chain: 100 −15 (w-17)
  // → +5 = 90 → −25 (w-10) → +5 = 70 → −30 (w-01) → +5 = 45.
  { id: "tx-11", teamId: "t-01", userId: "u-01", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 90, createdAt: "2026-09-01T09:12:00Z" },
  { id: "tx-12", teamId: "t-01", userId: "u-02", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 105, createdAt: "2026-09-01T10:02:00Z" },
  { id: "tx-13", teamId: "t-01", userId: "u-01", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 70, createdAt: "2026-09-02T08:45:00Z" },
  { id: "tx-14", teamId: "t-01", userId: "u-02", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 110, createdAt: "2026-09-03T09:40:00Z" },
  { id: "tx-15", teamId: "t-01", userId: "u-09", kind: "injection", amount: 20, description: "Injected by Rafa (leader)", balanceAfter: 100, createdAt: "2026-09-03T14:00:00Z" },
  { id: "tx-16", teamId: "t-01", userId: "u-01", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 45, createdAt: "2026-09-04T07:30:00Z" },
  { id: "tx-17", teamId: "t-01", userId: "u-06", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 105, createdAt: "2026-09-04T08:15:00Z" },
  // t-02 / t-03. The grant is per MEMBERSHIP (decision §4.2), not per user, so
  // u-01 is granted in all three teams — balances are per-team (DOM-013).
  // With no bets in either team, these rows ARE those teams' balances.
  { id: "tx-18", teamId: "t-02", userId: "u-02", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-07-15T20:00:00Z" },
  { id: "tx-19", teamId: "t-02", userId: "u-01", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-07-15T20:10:00Z" },
  { id: "tx-20", teamId: "t-02", userId: "u-07", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-07-16T10:00:00Z" },
  { id: "tx-21", teamId: "t-03", userId: "u-05", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-20T12:00:00Z" },
  { id: "tx-22", teamId: "t-03", userId: "u-01", kind: "onboarding-grant", amount: 100, description: "Onboarding grant", balanceAfter: 100, createdAt: "2026-08-21T09:00:00Z" },
  // Per (user, team, day), so these sit alongside the same users' t-01 rewards.
  { id: "tx-23", teamId: "t-02", userId: "u-02", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 105, createdAt: "2026-09-01T10:03:00Z" },
  { id: "tx-24", teamId: "t-02", userId: "u-07", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 105, createdAt: "2026-09-02T19:20:00Z" },
  { id: "tx-25", teamId: "t-02", userId: "u-02", kind: "daily-reward", amount: 5, description: "Daily login reward", balanceAfter: 110, createdAt: "2026-09-03T09:41:00Z" },
];

/** Convenience lookup for rendering names/colors from a wager or comment. */
export function getUser(userId: string): User | undefined {
  return mockUsers.find((u) => u.id === userId);
}

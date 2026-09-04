/**
 * Deterministic hand-written mock data for Phase 1 (ARC-010):
 * one fake team, fake users, bets in every lifecycle state with pari-mutuel
 * pools, wagers, and comments. No database, no randomness, no faker.
 */

import { CONFIG, DEFAULT_MAX_WAGER } from "./config";
import type { Bet, Comment, Team, Transaction, User, Wager } from "./types";

// nameColor values = the 10 curated name colors (design-visual-identity.md §2.4).
export const mockUsers: User[] = [
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

/**
 * t-01 member numbers are DERIVED, not hand-typed (settlement regression in
 * settlement.test.ts pins them): stakes leave the balance at placement, so
 * coinBalance = ledger credits (grant/rewards/injection) − stakes still in
 * flight (open/closed bets) + resolved payouts/refunds, and profitLoss is the
 * realized outcome of the resolved bets only (b-05 winner, b-06 void).
 */
export const mockTeam: Team = {
  id: "t-01",
  name: "SL Originals",
  leaderId: "u-01",
  accessMode: "free-for-all",
  inviteCode: "sl-originals-4ever",
  bannedUserIds: [],
  createdAt: "2026-08-01T18:00:00Z",
  members: [
    { userId: "u-01", role: "member", coinBalance: 45, profitLoss: -15, joinedAt: "2026-08-01T18:00:00Z" },
    { userId: "u-02", role: "moderator", coinBalance: 110, profitLoss: 50, joinedAt: "2026-08-01T18:05:00Z" },
    { userId: "u-03", role: "moderator", coinBalance: 80, profitLoss: 0, joinedAt: "2026-08-01T19:12:00Z" },
    { userId: "u-04", role: "member", coinBalance: 30, profitLoss: -60, joinedAt: "2026-08-02T10:30:00Z" },
    { userId: "u-05", role: "member", coinBalance: 90, profitLoss: 0, joinedAt: "2026-08-02T11:00:00Z" },
    { userId: "u-06", role: "member", coinBalance: 105, profitLoss: 25, joinedAt: "2026-08-03T14:45:00Z" },
    { userId: "u-07", role: "member", coinBalance: 60, profitLoss: 0, joinedAt: "2026-08-05T09:20:00Z" },
    { userId: "u-08", role: "member", coinBalance: 65, profitLoss: 0, joinedAt: "2026-08-07T21:10:00Z" },
    { userId: "u-09", role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-08-10T16:40:00Z" },
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
 */
export const mockTeams: Team[] = [
  mockTeam,
  {
    id: "t-02",
    name: "Lanhouse Legends",
    leaderId: "u-02",
    accessMode: "restricted",
    inviteCode: "lanhouse-legends-gg",
    bannedUserIds: [],
    createdAt: "2026-07-15T20:00:00Z",
    members: [
      { userId: "u-02", role: "member", coinBalance: 300, profitLoss: 200, joinedAt: "2026-07-15T20:00:00Z" },
      { userId: "u-01", role: "moderator", coinBalance: 80, profitLoss: -20, joinedAt: "2026-07-15T20:10:00Z" },
      { userId: "u-07", role: "member", coinBalance: 115, profitLoss: 15, joinedAt: "2026-07-16T10:00:00Z" },
    ],
  },
  {
    id: "t-03",
    name: "Churrasco FC",
    leaderId: "u-05",
    accessMode: "free-for-all",
    inviteCode: "churrasco-fc-2026",
    bannedUserIds: [],
    createdAt: "2026-08-20T12:00:00Z",
    members: [
      { userId: "u-05", role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-08-20T12:00:00Z" },
      { userId: "u-01", role: "member", coinBalance: 100, profitLoss: 0, joinedAt: "2026-08-21T09:00:00Z" },
    ],
  },
];

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
    resolution: { kind: "void" },
    createdAt: "2026-08-26T08:00:00Z",
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
];

/** Convenience lookup for rendering names/colors from a wager or comment. */
export function getUser(userId: string): User | undefined {
  return mockUsers.find((u) => u.id === userId);
}

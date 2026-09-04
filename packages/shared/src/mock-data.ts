/**
 * Deterministic hand-written mock data for Phase 1 (ARC-010):
 * one fake team, fake users, bets in every lifecycle state with pari-mutuel
 * pools, wagers, and comments. No database, no randomness, no faker.
 */

import { CONFIG, DEFAULT_MAX_WAGER } from "./config";
import type { Bet, Comment, Team, User, Wager } from "./types";

export const mockUsers: User[] = [
  { id: "u-01", displayName: "Rafa", nameColor: "#000000", avatar: "icon-dice" },
  { id: "u-02", displayName: "Duds", nameColor: "#444444", avatar: "icon-crown" },
  { id: "u-03", displayName: "Pri", nameColor: "#666666", avatar: "icon-ghost" },
  { id: "u-04", displayName: "Tomate", nameColor: "#222222", avatar: "icon-flame" },
  { id: "u-05", displayName: "Careca", nameColor: "#111111", avatar: "icon-bolt" },
  { id: "u-06", displayName: "Nina", nameColor: "#333333", avatar: "icon-star" },
  { id: "u-07", displayName: "Guiz", nameColor: "#555555", avatar: "icon-skull" },
  { id: "u-08", displayName: "Lelê", nameColor: "#777777", avatar: "icon-moon" },
  { id: "u-09", displayName: "Pinto", nameColor: "#888888", avatar: "icon-fish" },
  { id: "u-10", displayName: "Xis", nameColor: "#999999", avatar: "icon-target" },
];

export const mockTeam: Team = {
  id: "t-01",
  name: "SL Originals",
  leaderId: "u-01",
  accessMode: "free-for-all",
  inviteCode: "sl-originals-4ever",
  createdAt: "2026-08-01T18:00:00Z",
  members: [
    { userId: "u-01", role: "member", coinBalance: 143, profitLoss: 43, joinedAt: "2026-08-01T18:00:00Z" },
    { userId: "u-02", role: "moderator", coinBalance: 210, profitLoss: 110, joinedAt: "2026-08-01T18:05:00Z" },
    { userId: "u-03", role: "moderator", coinBalance: 95, profitLoss: -5, joinedAt: "2026-08-01T19:12:00Z" },
    { userId: "u-04", role: "member", coinBalance: 12, profitLoss: -88, joinedAt: "2026-08-02T10:30:00Z" },
    { userId: "u-05", role: "member", coinBalance: 61, profitLoss: -39, joinedAt: "2026-08-02T11:00:00Z" },
    { userId: "u-06", role: "member", coinBalance: 187, profitLoss: 87, joinedAt: "2026-08-03T14:45:00Z" },
    { userId: "u-07", role: "member", coinBalance: 74, profitLoss: -26, joinedAt: "2026-08-05T09:20:00Z" },
    { userId: "u-08", role: "member", coinBalance: 130, profitLoss: 30, joinedAt: "2026-08-07T21:10:00Z" },
    { userId: "u-09", role: "member", coinBalance: 3, profitLoss: -97, joinedAt: "2026-08-10T16:40:00Z" },
    { userId: "u-10", role: "member", coinBalance: CONFIG.ONBOARDING_GRANT_COINS, profitLoss: 0, joinedAt: "2026-09-01T12:00:00Z" },
  ],
};

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
  // b-05 (resolved, winner b-05-o2): pool 120
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

/** Convenience lookup for rendering names/colors from a wager or comment. */
export function getUser(userId: string): User | undefined {
  return mockUsers.find((u) => u.id === userId);
}

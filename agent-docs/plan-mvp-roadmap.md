# SL Fake Bets — Path to MVP Roadmap

Phased execution plan from the current frontend-only prototype to the `[mvp]` requirement set running against a 100%-local Supabase backend. Produced 2026-09-04 from a multi-agent map → propose (3 angles) → judge → synthesize pass over the codebase, `vision.md`, and `AGENT_SPEC.md`; revised the same day after a 3-agent verification audit (shared package, web app, spec/vision) — see §7.

**How to use this doc:**

- Each phase below is sized for ONE fresh agent session (roughly ≤ ~15 files / one subsystem). Start a new session per phase; the phase's Goal + Tasks + Exit criteria are written so the session can execute from this doc alone. A phase is done only when every exit criterion is verified. Do not start work from a later phase early.
- **Phase-numbering trap:** "Phase 1–9" in this doc is this roadmap's own breakdown. The spec and vision use a DIFFERENT 3-phase vocabulary (ARC-010/011/012: vision Phase 1 = frontend-only mock, Phase 2 = fully local backend, Phase 3 = hosted backend), and code comments like `title="Phase 1 — not wired"` use the VISION numbering. Roadmap Phases 1–2 live inside vision Phase 1; roadmap Phase 3 executes the vision 1→2 transition.
- Before writing code, read the spec IDs the task cites (`agent-docs/AGENT_SPEC.md`), §4's open-point decisions, and any shared module a task says to reuse.
- Standing constraints the current frontend already satisfies — preserve, don't rebuild, don't regress: UX-008 (bet ordering: open first, soonest-closing first), UX-009/010/011 (team selector / full re-scope on switch / returning users land on the default team dashboard), UX-014/015/016 (modal-first policy; bet detail is the only full page), UX-020/021 (black/white + jade identity; "SL", never "Soulless"), UX-025 (responsive), UX-026 (English-only), DOM-030 (no content moderation), ARC-014 (zero notifications).

## 1. Current state (as mapped and audit-verified 2026-09-04)

- Stack: Turborepo + pnpm workspaces; Next.js 16.3.4 App Router in `apps/web` with a single route `/` rendering `AppGate`; root scripts `dev`/`build`/`lint`/`typecheck` exist exactly as spelled. **No test runner is installed anywhere in the monorepo** (no vitest/jest, no `test` script).
- `packages/shared` is a well-modeled but purely declarative domain layer: real TypeScript types, one genuinely reusable pure function (`getPoolStats` in `pari-mutuel.ts` for pari-mutuel odds), a frozen `CONFIG` (`ONBOARDING_GRANT_COINS: 100`, `DAILY_REWARD_COINS: 5`, `TEAM_TARGET_SIZE: 30`, `BET_DURATION_PRESETS` 1h/24h/7d; plus standalone `DEFAULT_MAX_WAGER`), and deterministic mock fixtures — but zero validation, settlement, ledger, permission, or ID-generation logic.
- `Transaction["kind"]` is a closed union: `"onboarding-grant" | "daily-reward" | "injection" | "donation"`. There is NO kind for wager stakes, payouts, or refunds — matching DOM-025 (the ledger covers transfers/injections and is "distinct from wager logging") and DOM-026 (no per-wager audit trail; aggregated profit/loss instead). Fixture members carry hand-typed `coinBalance`/`profitLoss`; fixture transactions carry hand-typed `balanceAfter`; the fixture ledger contains no payout rows for the resolved bets. Keep this shape — see decision §4.6.
- `apps/web` has real UI plumbing: modal stack, team switching, hydration-safe auth gating, live pari-mutuel math in the wager modal via `getPoolStats`, and non-trivial client-side gating already in place (create-bet blocks submit without a title + ≥2 non-empty options; wager modal clamps the amount to `min(balance, bet.maxWagerPerUser)`; delete-team already has a working type-to-confirm gate). The dashboard rail already renders wallet, standings, and rank badges from mock data (`wallet-module`, `standings-module`, `standings-full-modal`, `rank-badge`). But **every mutating action** — create bet, place wager, create team, join by code, kick/ban, inject coins, delete team, save profile (hardcoded `disabled`), leave team (no handler), resend OTP (no handler) — is a dead handler or a submit that just closes its modal. The bet-title link is a literal `href="#"` (`bet-row.tsx`).
- Auth is a single localStorage boolean (`sl:signed-in`); the "current user" is `mockCurrentUserId` (`"u-01"`); all data comes from one static fixture file (`mock-data.ts`: bets b-01–b-03 open, b-04 closed, b-05 resolved-winner, b-06 resolved-void). There is no fetch/API/DB layer of any kind.
- `supabase/` is an explicit placeholder (README only), gated by ARC-013. No `@supabase/*` package is installed anywhere yet.

## 2. MVP definition

The target of this plan is **local-MVP**: every `[mvp]`-tagged requirement in `AGENT_SPEC.md` that can be satisfied on a developer machine, running against a **100%-local** Supabase backend (`supabase start`, no cloud project):

- Real per-device auth (email OTP + Google OAuth per UX-003/ARC-006; long-lived sessions per ARC-007).
- Persistent teams, membership, and moderation (kick/ban with active-wager cascade, access-mode gating, non-expiring invite codes).
- Persistent bets and wagers with correct pari-mutuel settlement (DOM-016/018/019), early-close (DOM-011), and hard team/bet deletion with type-to-confirm (DOM-033/034); stored per-team balances plus an auditable transfer ledger (onboarding grant, daily reward, leader injection — DOM-021/022/024/025) and aggregated profit/loss (DOM-026) — all flowing through `packages/shared`'s pure functions.
- Leaderboard, "podium of the poor", and name badges live from real balances (DOM-027/028/029).
- Profile editing incl. avatar image upload to local Supabase Storage (UX-022).
- Deep links: invite and bet-share URLs route into the join/bet flow, destination preserved through signup (UX-012).
- Realtime propagation of new bets/wagers/comments without manual refresh (ARC-005/UX-013).
- In-house `analytics_events` / `feature_flags` tables, exactly two funnel metrics (ARC-016/017; no third-party vendor).
- Dynamic OG/Twitter previews for invite and bet-share links + baseline public-page SEO (UX-017/023/024).
- The free-tier-ceilings and scale-up-path documentation the spec mandates (ARC-001/ARC-004) — written, not built.

**The one `[mvp]`-tagged item deliberately outside this plan is ARC-012** (hosted dev backend — Supabase Cloud + Vercel): it is a separate, later, owner-gated transition. Phase 9's checkpoint is therefore **"local-MVP complete"**, not "every `[mvp]` tag closed".

## 3. When the local backend starts

**Local backend work begins at Phase 3**, immediately after Phases 1–2 have made both frontend-only vertical slices (bet lifecycle; team lifecycle + comments) fully real against in-memory client state, per the vision's frontend-placeholders-first rule (ARC-010). Rationale: a durable per-device identity is the first thing the app structurally cannot fake in memory, and every later phase (persistence, ledger, realtime) depends on real identity and a real schema. Auth is deliberately its own phase (4) so Docker/CLI bootstrap friction and auth-provider friction never compete for one session's budget.

> **ARC-013 gate — read before Phase 3.** Naming Phase 3 as the transition point is **not** the owner's authorization to run it. In vision numbering, roadmap Phase 3 is the Phase 1→2 transition (ARC-011), exactly what ARC-013 gates: *"never advance a phase (1→2, 2→3) without the owner's explicit instruction for that specific move, in that moment."* Before any Phase 3 command (`supabase init`, `supabase start`) executes, the owner must give a separate, explicit, in-the-moment order for that specific transition. Finishing Phases 1–2 does not auto-authorize it. The same gate applies again, separately, to the future hosted-backend transition (ARC-012).

## 4. Open spec points this plan resolves (owner may overrule)

`AGENT_SPEC.md` leaves several points explicitly or implicitly open. Executing sessions follow these defaults — do not silently re-decide them differently; each is cheap to change if the owner overrules:

1. **Email auth flavor = OTP code.** ARC-006 leaves magic link / OTP / password open; OTP is the lowest-friction flavor that also works cleanly against `supabase start`'s local mail sandbox (Inbucket/Mailpit).
2. **Onboarding grant is per team membership, applied on create/join.** DOM-021 phrases the grant per-user ("new users get…"), but DOM-013 makes balances per-team and `Transaction` requires a `teamId` — a signup-time grant has nowhere to land, and the spec never resolves this tension (it is not in its own open-decisions list). Default: every new membership starts at `CONFIG.ONBOARDING_GRANT_COINS` via an `"onboarding-grant"` transaction — which is exactly what the fixtures model.
3. **Daily reward is per (user, team, calendar day), granted lazily on team load.** DOM-022 flags unconditional-vs-only-when-broke as ambiguous; spec default A-2 says unconditional. Per-team scoping follows the same rationale as #2.
4. **Kick/ban wager cascade = remove the member's wagers from all active pools.** DOM-032 mandates the removal but explicitly leaves refunded-vs-forfeited-vs-removed open. Since the per-team balance is deleted along with the membership, "refund to the removed member" has no durable target; plain removal is the default — pools shrink and everyone else's odds recompute automatically because `getPoolStats` runs over live wagers. The cascade must still go through one shared `settlement.ts` helper so the Phase 2 in-memory version and the Phase 5 RPC behave identically.
5. **Bet options floor = 2, no maximum.** DOM-007 says options are plural but marks min/max count open.
6. **Ledger scope stays spec-literal (DOM-025/026).** Transactions = grants/rewards/injections (the `"donation"` kind stays reserved for post-MVP DOM-023). Wager stakes, payouts, and void refunds mutate stored balances + aggregated `profitLoss` via `settlement.ts` and are **not** ledger rows — do not extend `Transaction["kind"]`, do not event-source balances by replaying history. Balances are stored on the member (per types + fixtures) and updated atomically with each mutation.

## 5. Phases

### Phase 1 — Bet lifecycle: real logic, in-memory state ✅ COMPLETE (2026-09-04)

> **Completion note (2026-09-04).** All 11 tasks done; exit criteria verified (`typecheck`/`lint`/`build` green; vitest b-05/b-06 regression passes 10/10; both routes smoke-tested). Records for later phases:
> 1. **Fixture fix (risk #8 confirmed):** the hand-typed `coinBalance`/`profitLoss`/`balanceAfter` numbers did not survive the settlement regression — `mock-data.ts` t-01 members and the ledger were rewritten to derived-consistent values (complete ledger: one grant per membership + rewards + injection). The regression test now pins them.
> 2. **Providers moved to the root layout** (`app-providers.tsx`): required so the new `/bet/[id]` route shares the same in-memory TeamProvider state across client navigation. `AuthGated` (app-gate.tsx) is the reusable per-route gate; ModalRoot mounts globally.
> 3. **DOM-017 enforced as a cumulative per-(user, bet) cap** (`validateWager`'s `existingStake`), not per-wager — the literal per-wager reading lets repeat wagers bypass the max.
> 4. **Single-source cleanups beyond the task list:** `bet-row`'s ResolvedOutcome now renders from `settleBet` (was duplicated float math); `team-switcher` open-bet counts and `transactions-modal` team P/L now read live context state (were static mock imports that would have gone stale).
> 5. Context's inline `canCreateBet`/`canInvite`/`canManage` flags deliberately NOT migrated to `permissions.ts` (that is Phase 2 task 1); all NEW code (mutators, bet-detail page) already uses `permissions.ts`.

**Goal:** make create-bet → wager → early-close → resolve fully real (DOM-007/008/012/017, DOM-011, DOM-014, pari-mutuel settlement per DOM-016/018/019, DOM-001 leader invariant) against client-side in-memory state, before any backend exists. Produces the exact pure functions the backend will call unchanged in Phases 5–7.

**Tasks:**
1. `packages/shared`: add `validation.ts` — bet requires title + `options.length >= 2` (decision §4.5) + `closesAt` (DOM-007); `wager <= bet.maxWagerPerUser` (DOM-017); `wager <=` placing user's `coinBalance` and never negative (DOM-014); BetState transition legality (open→closed→resolved only, DOM-012); and DOM-001's exactly-one-leader invariant as its own explicit, named check for reuse anywhere leadership matters.
2. `packages/shared`: add `settlement.ts` — given a Bet + its Wagers + a BetResolution, compute per-member `coinBalance`/`profitLoss` deltas (winner payout via `getPoolStats` pool multiplier; void = full refund; no rake). Per decision §4.6 it emits **no Transaction rows** — resolution is not a ledger event. Include the shared active-wager-removal helper for the kick/ban cascade (decision §4.4). This is the single module Phase 2's cascade and Phase 7's `resolveBet` RPC both call unchanged.
3. `packages/shared`: add `ledger.ts` — `applyTransaction(member, kind, amount, …)` returning the updated member + a `Transaction` row with a correct `balanceAfter` snapshot (used by grant/reward/injection paths in Phases 2/5/7), plus `deriveProfitLoss(userId, resolvedBets, wagers)` — a pure recompute of aggregated P/L (DOM-026) used by the regression check and Phase 7's consistency guard. Balances stay **stored**, per decision §4.6 — `ledger.ts` does not derive balances from history.
4. `packages/shared`: add `permissions.ts` — `canCreateBet` / `canResolveBet` / `canCloseBetEarly` (DOM-011) / `canInvite` / `canManageTeam` / `canKick` / `canBan` / `canInjectCoins` (leader-only, not moderators — DOM-024), derived purely from TeamRole + accessMode + leader flag. Single home for authorization logic; Phase 2 migrates `team-context.tsx`'s inline computation (current field names there: `canCreateBet`/`canInvite`/`canManage`) onto it.
5. `packages/shared`: add `state-machine.ts` — `computeEffectiveState(bet, now)` for `closesAt`-driven open→closed auto-transition, plus a guard blocking new wagers once a bet is effectively closed.
6. `packages/shared`: add `id.ts` — bet/wager/transaction id generation + invite-code generation with an explicit uniqueness check (pure, given an existing code set).
7. Test setup + regression check: the monorepo has **no test runner** — add vitest to `packages/shared` (devDependency, `test` script, turbo task), then write the b-05/b-06 regression: feed the resolved fixtures through `settlement.ts` + `deriveProfitLoss` and assert the outputs reproduce the fixtures' hand-typed `coinBalance`/`profitLoss`. Assert against member fields, not transactions — the fixture ledger has no payout rows by design. If the hand-typed fixture numbers prove internally inconsistent, fixing `mock-data.ts` is in scope for this phase.
8. `apps/web/src/lib/team-context.tsx`: convert static mock arrays into real client state (`useReducer`) seeded from mock-data; add mutators `addBet`, `placeWager`, `closeBetEarly`, `resolveBet`, `addTransaction` calling the new pure functions.
9. Wire `create-bet-modal.tsx` submit to `addBet`. The modal already gates submit client-side (title + ≥2 non-empty options) — route that gating through `validation.ts` so client and future server share one source of truth, and add DOM-008's custom close-time picker / DOM-009's optional emoji icon if the modal only has the presets.
10. Wire `wager-modal.tsx` submit to `placeWager`. The modal already clamps to `min(balance, maxWagerPerUser)` — what's missing is blocking after effective close (`state-machine.ts`), the actual mutation, and pool stats that live-update after placing (wagers must become state).
11. Add a minimal bet-detail route (`apps/web/src/app/bet/[id]/page.tsx`) replacing `bet-row.tsx`'s dead `href="#"`: full bet info + wager list + a `canResolveBet`-gated Resolve control and a `canCloseBetEarly`-gated early-close control (DOM-011).

**Exit criteria:**
- `pnpm typecheck` and `build` pass; the new vitest regression (b-05 winner, b-06 void) passes.
- Manual flow (no persistence needed): create a bet with ≥2 options (1-option submit blocked), place wagers as the current mock user, close one early as creator/moderator (further wagers blocked), resolve another (winner or void), and see `coinBalance`/`profitLoss` update correctly for every affected member. Resolution adds **no** ledger rows (decision §4.6).
- Wagers over balance, over per-user max, or after effective close are blocked in the UI with a visible reason.
- Bet-title link opens a real bet-detail page.

**Sizing:** ~12–14 files (6 new shared modules + vitest setup/test, `team-context.tsx`, 2 modal submits, 1 new page). One subsystem; no backend/auth mixed in.

### Phase 2 — Team lifecycle & comments: real logic, in-memory state ✅ COMPLETE (2026-09-04)

> **Completion note (2026-09-04).** All 8 tasks done; exit criteria verified (`typecheck`/`lint`/`build` green; vitest 27/27 incl. a new `team-lifecycle.test.ts`; both frontend flows clicked through headless — 34/34 assertions). Records for later phases:
> 1. **Two spec-open points resolved by this phase** (both now unit-pinned in `team-lifecycle.test.ts`, both cheap to overrule): **the leader cannot leave** (`canLeaveTeam` — DOM-001 demands exactly one leader and leadership transfer is explicitly unspecified, so the leader's only exit is deleting the team), and **a member cannot leave/delete their last team** (a team-less shell belongs to onboarding, UX-028, which no phase before 5 has a screen for).
> 2. **New shared surface Phases 5–7 must reuse, not reimplement:** `permissions.ts` gained `canDeleteTeam` (leader-only), `canDeleteBet` (creator/moderator set), `canJoinTeam` (blocks existing members and bans), `canLeaveTeam`, `canComment`; `settlement.ts` gained `removeMemberWagersInTeam` (the kick/ban cascade, **team-scoped** — the Phase-1 `removeMemberActiveWagers` alone would have wiped the user's wagers in *every* team) and `reverseBet`; `validation.ts` gained `validateTeamDraft`/`validateInviteCode`/`validateProfileDraft`/`validateCommentBody`/`validateInjection`; `config.ts` gained `NAME_COLORS` (the 10 curated hexes, now the single source the profile picker and the fixtures share).
> 3. **`Team.bannedUserIds: string[]` added to `types.ts`** — A-4's ban-blocks-rejoin has nowhere else to live once the membership row is gone. Phase 3's schema maps it to a `team_bans` table, not a column.
> 4. **Bet deletion unwinds the bet's money (`reverseBet`), it does not just drop rows.** Stakes return to their owners, and a *resolved* bet's payouts and realized P/L are unwound too — otherwise deleted history silently breaks `deriveProfitLoss`, which only ever sees surviving bets. Deliberately unlike the kick/ban cascade, where the whole per-team balance disappears with the membership so there is nothing to refund to (decision §4.4).
> 5. **Ledger rows outlive memberships** (DOM-025: "auditable, never lost"), but per-team balances do not — a kicked or departed member's grant rows stay while their balance is deleted, and re-joining starts a fresh balance at the grant. **Phase 7's consistency guard must therefore replay only from the current membership's `joinedAt`, not from the whole ledger**, or it will report false drift.
> 6. **`addTransaction` was removed from the context's public API**, replaced by the gated `injectCoins` — an ungated ledger writer next to `canInjectCoins` is a footgun, and nothing consumed it. Phase 5's RPC set matches the mutator names one-for-one.
> 7. **`users` and `comments` joined the reducer, and `getUser` was retired from all 6 component call sites** in favor of the context's `userById` — profile edits must repaint every name at once (UX-022). `teams` exposed by the context is now only the teams the user actually belongs to (UX-009), so leaving one removes it from the switcher.
> 8. **Two exit criteria are not observable with one hardcoded identity** and are covered by unit tests instead, not by the click-through: joining "as a second mock user" (the walkthrough leaves and re-joins t-03 by code, exercising the identical path), and the access-mode toggle changing *someone else's* `canCreateBet` — only mods and the leader can flip it, and A-1 means they are never gated by it. Both close for real in Phase 5's two-real-user walkthrough.

**Goal:** team creation/joining/moderation/profile-editing, bet deletion, and per-bet comments fully real against the same in-memory model — the second and final frontend-only slice before the backend transition.

**Tasks:**
1. `team-context.tsx`: replace inline `canCreateBet`/`canInvite`/`canManage` computation with calls into Phase 1's `permissions.ts` (authorization lives in exactly one place going forward).
2. Extend `team-context.tsx` mutators: `createTeam` (single-leader invariant via `validation.ts`; seeds the creator's membership with the onboarding grant via `ledger.ts` — decision §4.2), `joinTeamByCode` (same grant on join), `kickMember`/`banMember` (DOM-031/032: cascade-remove the target's active wagers **via Phase 1's `settlement.ts` helper — not a second reimplementation**; decision §4.4), `updateTeamSettings` (access mode, DOM-002), `deleteTeam` and `deleteBet` (hard deletes behind type-to-confirm, DOM-033/034), `updateProfile`, `leaveTeam`, `addComment`, `injectCoins` (gated by `canInjectCoins`; writes an `"injection"` Transaction via `ledger.ts`, DOM-024/025).
3. Wire `create-team-modal.tsx` submit to `createTeam` and auto-switch to the new team.
4. Wire `team-switcher.tsx` join-by-code form to `joinTeamByCode` (currently a no-op clearing the input).
5. Wire `team-settings-modal.tsx`: access-mode toggle, Inject → `injectCoins`, Kick/Ban, Delete team (the type-to-confirm gate already works — wire its confirmed action) to real mutators, gated by `permissions.ts`.
6. Wire `profile-modal.tsx` Save (currently hardcoded disabled) to `updateProfile` (name/avatar/color).
7. Wire `profile-menu.tsx` "Leave team" (currently no handler) to `leaveTeam`.
8. Bet-detail page: add comment posting (textarea + submit → `addComment`, rendering mock + new comments — UX-018 shape; no realtime/persistence yet) and a delete-bet control behind type-to-confirm (DOM-033/034), gated by `permissions.ts`.

**Exit criteria:**
- `pnpm typecheck` and `build` pass.
- Manual flow: create team (creator's balance starts at `ONBOARDING_GRANT_COINS` with a ledger row); join from a second mock user via invite code (same grant); leader kicks/bans a member and their roster row + active wagers disappear with pool odds recomputing; leader injects coins and the recipient's balance + ledger update; access-mode toggle updates `canCreateBet`/`canInvite` gating live; profile edit persists in-session; posting a comment appears immediately; deleting a bet removes it after type-to-confirm.
- No dead-handler buttons remain among: create-team submit, join-by-code, kick/ban, inject, delete-team, profile Save, leave-team.
- Permission values sourced from `permissions.ts`, not recomputed inline.

**Sizing:** ~10–12 files but the densest frontend phase (10 mutators, cascade + gating logic). A fresh session must **read Phase 1's `settlement.ts` and `permissions.ts` first** rather than re-derive their rules.

### Phase 3 — Local backend bootstrap ✅ COMPLETE (2026-09-05) **[LOCAL BACKEND START — owner order required]**

**Goal:** execute the owner-gated transition (ARC-013; vision phase 1→2, ARC-011) at infrastructure level only: Supabase 100% local via CLI+Docker, FULL schema in one pass, RLS scoped to `permissions.ts` rules, storage bucket, local auth providers configured — so Phases 4–9 only add RPCs, tighten policies, and rewire UI against tables that already exist. **Do not run any command in this phase without the owner's separate, explicit, in-the-moment order.**

**Tasks:**
1. `supabase/`: `supabase init` + local Docker config (`supabase start`) — first real content in the directory.
2. Migrations covering the full schema in one pass: domain tables `users`, `teams`, `team_members`, `invite_codes`, `bets`, `bet_options`, `wagers`, `transactions`, `comments` field-for-field with `types.ts` (transaction `kind` stays the 4-value union; `coin_balance`/`profit_loss` are stored columns on `team_members` — decision §4.6), plus infra tables `analytics_events` and `feature_flags` (no `types.ts` counterpart exists — define their shape in the migration and optionally add matching types to `packages/shared`). Include ARC-015's design check: the schema must let notification events hang off later without redesign.
3. RLS policies for every table, scoped to team membership and the role/accessMode rules from `permissions.ts` (user reads/updates only own `users` row; team-scoped tables gated by membership + role).
4. Configure local Supabase Auth providers: email OTP + Google OAuth (dev credentials) — provider config only; no app code changes (auth-context rewrite is Phase 4).
5. Avatars Storage bucket + access policies (UX-022's custom image upload; local Supabase Storage).
6. Seed script translating `mock-data.ts` fixtures into local Postgres rows (dev-only, reproducible via `supabase db reset`).
7. Minimal `apps/web/src/lib/supabase/client.ts` + `server.ts` with one read-only smoke-test query — nothing else in `apps/web` changes.

**Exit criteria:**
- `supabase start` runs locally; `supabase db reset` applies all migrations cleanly.
- Seeded Postgres reproduces `mock-data.ts`'s teams/bets/wagers/users.
- Manual RLS check: a non-leader cannot resolve a bet or inject coins into another member; a leader can. The avatars bucket accepts an upload in Studio under its policies.
- `apps/web` still runs entirely on Phase 1/2 in-memory state, unaffected.

**Execution notes (2026-09-05).** Owner gave the ARC-013 order for the vision 1→2 move; all seven tasks done and every exit criterion verified. Deviations and findings a later phase must know about:

- **`team_bans` was added** beyond the roadmap's table list. `types.ts` names that exact table for this exact phase, and without it A-4's ban-blocks-rejoin (the only functional difference between kick and ban, DOM-031) has nowhere to persist — a schema migration in Phase 5, which "full schema in one pass" exists to prevent.
- **`Team.inviteCode` became the `invite_codes` table**, as the roadmap's own table list implies. The scalar is reproduced by a partial unique index (one active row per team) and the shape now supports open decision #6 without redesign.
- **Ids are `uuid`**, not `id.ts`'s prefixed strings: `public.users.id` must equal `auth.users.id`. TypeScript still sees `string`, so `types.ts` is unchanged — but Phase 6 must stop calling `generateId()` for anything the database now defaults.
- **Two documented RLS departures** from this doc's one-line summary. `users` SELECT also covers teammates (own-row-only would make every wager, comment and leaderboard row unrenderable from Phase 5 on, since UX-022 renders names everywhere). `team_members` INSERT covers only the founder's own membership — RLS cannot verify possession of an invite code, so **Phase 5 must add a `join_team_with_code` SECURITY DEFINER RPC**; until it exists there is no join path at all.
- **DOM-007's two-option floor is NOT enforced in the schema.** It is a row-count invariant, which no CHECK can express. `validateBetDraft` owns it today; **Phase 6's createBet RPC must enforce it server-side.**
- **Trap, cost one silent authorization hole:** a write-gating trigger must never be `SECURITY DEFINER`. Inside a definer function `current_user` is `postgres`, so `app.is_service_context()` returns true for every caller and the trigger disarms itself — this let a moderator inject coins (DOM-024) until the exit check caught it. Phases 5–7 add more such triggers: keep them SECURITY INVOKER, and let the `app.*` helpers they call be the definers.
- **Sizing was accurate on files, wrong on friction.** The Docker/CLI risk (#2) landed on the environment instead: macOS 12 has no Homebrew bottles, Colima is a dead end there (Lima's `vz` needs macOS 13+, and qemu has no Monterey bottle), and the resolution was Docker Desktop 4.41.2 — the last build supporting this OS.

**Sizing:** ~13–15 files, almost entirely SQL/config — which is what makes a full-schema pass safe in one session. Expect Docker/CLI environment friction to consume real time despite the modest file count.

### Phase 4 — Real auth ✅ COMPLETE (2026-09-05)

**Goal:** replace the fake `sl:signed-in` boolean with real Supabase Auth sessions (email OTP + Google OAuth — flavor per decision §4.1) against Phase 3's config, giving the app a genuine per-device identity with long-lived sessions (ARC-007).

**Tasks:**
1. **Pre-flight (outside agent control):** confirm Google OAuth dev credentials exist in Google Cloud Console *before* starting the session — missing credentials can stall the whole phase.
2. Rewrite `apps/web/src/lib/auth-context.tsx` to hold a real Supabase session (server+client via `@supabase/ssr`, against Next 16 App Router).
3. Add `app/auth/callback/route.ts`; wire `auth-page.tsx`'s email OTP request/verify flow, the Google OAuth button, and the previously-inert "Resend code" button. The callback and the OTP flow must honor a `?next=` destination parameter — the groundwork UX-012's deep links build on in Phase 5.
4. Wire `app-gate.tsx` gating to the real session, preserving its hydration-safe (null-until-mount) pattern.
5. Configure long-lived sessions (ARC-007): local auth token/refresh lifetimes so returning users essentially never re-login.
6. Retire `mockCurrentUserId` for auth purposes only — team/bet/wager data still runs on Phase 1/2 in-memory state. **Note: the onboarding grant does NOT fire here.** It is per team membership (decision §4.2) and teams are still in-memory in this phase; Phase 5's `createTeam`/`joinTeamByCode` RPCs own it.

**Exit criteria:**
- Real user signs up via email OTP locally and the session survives reload; Google OAuth works against local dev config.
- A `?next=` destination round-trips intact through both the OTP flow and the OAuth callback.
- AppGate gates on the real session; Phase 1/2 flows still run on in-memory state.

**Execution notes (2026-09-05).** Google dev credentials were already in place from Phase 3 (`supabase/.env`), so the pre-flight cost nothing. All six tasks done; exit criteria verified end-to-end in a real browser (Chrome via puppeteer-core, installed OUTSIDE the repo — no new dependency was added to `apps/web`). What a later phase needs to know:

- **`middleware.ts` is `src/proxy.ts`.** Next 16 deprecated and renamed the convention; same runtime, same matcher. It exists because ARC-007 is delivered by the refresh token, not by the access token — the access token stays at the 1-hour default (that decision was already made and documented in Phase 3's `config.toml`), so something must spend the refresh token before the server renders. Verified: the session survives a full browser process restart, and the auth cookie carries a ~400-day expiry.
- **Deviation from task 4, deliberate:** the null-until-mount pattern is gone from the normal path. It existed because fake auth lived in `localStorage`, which the server cannot read; a cookie session CAN be read server-side, so the root layout resolves the user and hands it to `AuthProvider` as `initialUser`. First client render matches the server render — same hydration safety, minus the splash frame every visit paid (UX-011 reads better for it). `AppGate` keeps its `signedIn === null` branch as a fallback for a provider mounted without a server value.
- **Profile rows are created by a database trigger,** not by the client — `20260905130000_auth_profile_bootstrap.sql`. The Phase 3 schema comment on `public.users` ("Created on signup in Phase 4") assigned this here, and it is not in the task list above. A trigger rather than a client insert because there are three signup paths (OTP, OAuth, `seed.sql`) and a client-side insert leaves a profile-less identity behind whenever the tab closes mid-flow. UX-002 defaults are generated in SQL (display name from Google's name or the email local part, a random `NAME_COLORS` entry, a random avatar icon). **This is the one place the color palette is duplicated outside `config.ts`** — as a default only; `validateProfileDraft` still owns the palette.
  - Consequence for `seed.sql`: the trigger now fires for the 10 fixture identities too, so the fixture profile insert became an **upsert**. Verified that fixture values still win after `db reset`.
  - The avatar defaults are the **8 ids the profile modal can actually render**, not the 10 in `mock-data.ts` — `icon-fish` and `icon-target` are in the fixtures but not in the picker, so defaulting to one would be a dead end. That fixture/picker mismatch predates this phase and was left alone.
- **`safeNextPath` is the single open-redirect guard**, and the single `as Route` assertion in the auth code (`typedRoutes` cannot type a value that arrives from a query string). Verified: `?next=https://evil.example` and `?next=//evil.example` both collapse to `/`.
- **The callback swallows Supabase's exchange error** and logs it instead. Its PKCE message is three lines of SSR-framework advice aimed at a developer; provider errors from Google are still surfaced verbatim because those are the ones a user can act on.
- **Google OAuth is verified up to Google's own consent screen** — the app hands off to `accounts.google.com` with the right dev `client_id` and `next` intact through `redirect_to`. The final leg needs a human entering Google credentials and is the owner's to confirm.
- **`?next=` round-trips through both flows** and, because `AuthGated` renders the auth screen at the visitor's own URL, a logged-out deep link needs no parameter at all — the pathname IS the destination. Verified end-to-end: logged out at `/bet/b-01` → OTP signup → back at `/bet/b-01`.
- **`mockCurrentUserId` stays** in `team-context.tsx` on purpose. Auth is real, but teams/bets/wagers are still Phase 1/2 fixtures keyed to `u-01`; pointing it at the real uuid would detach the signed-in user from every fixture they appear in. Phase 5 swaps it together with the move onto Supabase queries.

**Sizing:** ~7–9 files, auth-only. Kept separate from bootstrap so two friction-prone concerns (Docker infra, external auth providers) never share a session. *Actual: 13 files (11 in `apps/web`, one migration, one seed edit) — the extra spend was the profile-bootstrap trigger inherited from Phase 3, not auth itself.*

### Phase 5 — Team & membership persistence

**Goal:** teams, membership, roles, invites, deep-link joining, and the team-scoped ledger write path become real Postgres data behind real auth (DOM-001/002/003, DOM-005/006 + UX-005 non-expiring invites, DOM-021 grant, DOM-024/025 injection ledger, DOM-031/032 moderation, DOM-033/034 team deletion, UX-012 invite routing, UX-022 avatar upload), replacing Phase 2's in-memory team mutators.

**Tasks:**
1. Server actions/RPC: `createTeam` and `joinTeamByCode` (invite-code uniqueness via `id.ts`; both seed the new membership with the onboarding-grant transaction via `ledger.ts` — decision §4.2), `kickMember`/`banMember` (active-wager cascade **via Phase 1's `settlement.ts` helper — reuse, don't reimplement**; decision §4.4), `updateTeamSettings`, `deleteTeam` (type-to-confirm), `leaveTeam`, `updateProfile`, `injectCoins` (leader-only per `canInjectCoins`; writes an `"injection"` row via `ledger.ts`).
2. Tighten Phase 3's provisional RLS for `teams`/`team_members`/`invite_codes`/`transactions` now that real access patterns exist (e.g. `SECURITY DEFINER` functions for kick/ban/injectCoins so a member cannot self-grant or self-promote). No new tables — policy-tightening migrations only.
3. Rewire `team-context.tsx` from the local reducer to Supabase queries on mount + the new RPCs for mutation, keeping permission derivation via `permissions.ts`. **Note:** this is the useMemo-over-static-arrays → query-driven-state refactor (loading/error handling included) — budget for it explicitly. Keep the context's public interface stable so the read-only rail modules (wallet, standings, ticker) keep working untouched.
4. Rewire `create-team-modal`, `team-switcher` (list + join), `invite-modal` (real `invite_codes` row instead of `team.inviteCode` mock), `team-settings-modal` (incl. Inject), `profile-menu` leave-team, `profile-modal` save — the save now includes avatar image upload to Phase 3's Storage bucket (UX-022).
5. Add the public `app/join/[code]/page.tsx` route: an invite link routes straight into the join flow; a logged-out visitor goes through Phase 4's auth with the destination preserved via `?next=` and lands back in the join flow after signup (UX-012; codes never expire per DOM-005/UX-005; who may generate codes follows access mode per DOM-006).

**Exit criteria:**
- `pnpm typecheck`/`build` pass; local Supabase running.
- Two real authenticated users (e.g. two browser profiles): A creates a team (membership seeded with the grant — ledger row + starting balance visible); B opens `join/[code]` logged-out, signs up via OTP mid-flow, lands back in the join flow, joins, and gets their own grant; A kicks B and the roster row + B's active wagers vanish with pool odds recomputing; A injects coins and the member's balance/ledger updates; an uploaded avatar renders after reload.
- Restarting dev server / Supabase and reloading shows the same state (durable persistence).

**Sizing:** ~12–14 files; no new tables (Phase 3 created every table and the bucket this phase writes).

### Phase 6 — Bet & wager persistence

**Goal:** bets, options, and wagers become real Postgres data scoped to real teams (DOM-007/008/009/012/017 bet shape & states; DOM-013/014 balance scoping and caps enforced server-side; DOM-016 pool math from live rows; DOM-011 early close; DOM-033/034 bet deletion), replacing Phase 1's in-memory bet/wager state.

**Tasks:**
1. Server actions/RPC: `createBet`, `placeWager`, `closeBetEarly` (creator/moderator via `canCloseBetEarly`), `deleteBet` (type-to-confirm) — reusing `validation.ts` and `state-machine.ts` (`closesAt` gating) as the single source of truth, not reimplemented in SQL; over-balance/over-max/after-close rejected server-side (DOM-013/014/017).
2. Tighten Phase 3's provisional RLS for `bets`/`bet_options`/`wagers` scoped to team membership (policy-tightening migrations only).
3. Rewire `create-bet-modal`, `wager-modal`, `bet-feed`, `bet-row`, and the bet-detail page's read/wager/early-close/delete UI to Supabase.
4. `getPoolStats` now runs against live DB-fetched wagers.

**Exit criteria:**
- `pnpm typecheck`/`build` pass.
- Two real users on a shared team: A creates a bet, B places a wager; displayed odds/pool totals match `getPoolStats` computed from DB rows; A closes a bet early and B's further wagers are rejected; deleting a bet hard-removes it after type-to-confirm.
- Data survives server restart; over-balance / over-max / after-close wagers rejected **server-side**, not just client-side.

**Sizing:** ~11–13 files. Resolution/ledger deliberately deferred to Phase 7 to stay under budget.

### Phase 7 — Resolution, ledger, daily rewards & standings

**Goal:** resolving a bet actually pays out (DOM-016/018/019); the transfer ledger and stored balances become real and consistent (DOM-025/026, decision §4.6); daily reward becomes a real idempotent grant (DOM-022); leaderboard/podium/badges run on live data (DOM-027/028/029).

**Tasks:**
1. Server action/RPC `resolveBet` reusing `settlement.ts` (winner payout by pool multiplier; void = full refund) — atomically updates stored `coin_balance`/`profit_loss` on `team_members`. Per decision §4.6 it writes **no** payout/refund ledger rows.
2. Idempotent daily-reward issuance (`CONFIG.DAILY_REWARD_COINS`): once per (user, team, calendar day), granted lazily on team load (decision §4.3), written as a `"daily-reward"` transaction via `ledger.ts`.
3. Consistency guard instead of derived balances: a dev-mode check that recomputes aggregated P/L via `deriveProfitLoss` and replays grant/reward/injection rows to validate stored balances, catching drift; RLS ensures the RPCs are the only balance write path (no direct client updates).
4. Rewire the Phase-1 resolve control, `wallet-module`, and `transactions-modal` (the ledger shows grants/rewards/injections only — DOM-025) to real data; persist bet-detail comments (from Phase 2) to Phase 3's `comments` table.
5. Standings verification (DOM-027/028/029): leaderboard of richest, "podium of the poor" (biggest losers), and name-badge tiers (top5/bottom5/ranks 1-2-3) render correctly from live balances — the modules already exist (`standings-module`, `standings-full-modal`, `rank-badge`); extend them if the draft lacks the podium or badge tiers.

**Exit criteria:**
- `pnpm typecheck`/`build` pass.
- Leader resolves a bet with real wagers from multiple real users; winners' balances/profitLoss update correctly and survive restart; void resolution fully refunds every wagerer; the ledger gains no rows from resolution.
- Daily reward grants exactly once per user per team per calendar day (attempt twice in one day to verify).
- Comments persist across reload for all team members; standings/podium/badges are correct against the live data; the consistency guard passes after a full manual walkthrough.

**Sizing:** ~11–13 files. Last purely-backend-logic phase before realtime/polish.

### Phase 8 — Realtime propagation

**Goal:** close the liveness gap (ARC-005/UX-013, extended to UX-018's comments): bets, wagers, and comments propagate to other online team members without manual refresh, using **coarse-grained** Supabase Realtime subscriptions only.

**Tasks:**
1. Coarse-grained subscriptions only: one per-team channel for the bet list, one per-bet-page channel for wager/comment updates (Postgres Changes/Broadcast). Locally there are no hard connection limits — the coarse design exists so the future hosted transition fits Supabase's free-tier ceilings (200 concurrent connections / 2M messages per month), which Phase 9's ARC-001/004 doc records.
2. Wire `team-context.tsx` and the bet-detail page to live-update on relevant INSERT/UPDATE events.
3. Subscription lifecycle: subscribe once per mounted team/bet context; tear down cleanly on unmount/team switch; guard races between a just-arrived realtime event and an in-flight manual refetch.
4. Verify channel-count discipline in the local Realtime inspector matches the coarse granularity (per team/bet-list/bet-page — never per-row/per-field).

**Exit criteria:**
- Two real browser sessions in the same team see a new bet, an updated pool multiplier from another user's wager, and a new comment appear live with no refresh.
- Rapid team switching produces no duplicate/ghost subscriptions or updates.
- Realtime inspector channel count matches the coarse-grained design.

**Sizing:** ~8–10 files. Own phase because subscription lifecycle/cleanup/races can plausibly consume a full session alone.

### Phase 9 — Analytics, flags, SEO & scale docs **[LOCAL-MVP COMPLETE]**

**Goal:** close the remaining `[mvp]` items that only make sense with real data/traffic: in-house analytics + feature flags (ARC-016/017), real SEO/social previews (UX-017/023/024), and the spec-mandated free-tier/scale-up documentation (ARC-001/004).

**Tasks:**
1. Verify onboarding is structured as discrete steps (UX-028 — the instrumentation prerequisite), then instrument the two specified funnel points into the existing `analytics_events` table: onboarding per-step drop-off; invite-open → signup conversion. Exactly these two — ARC-017 forbids anything broader.
2. Simple `feature_flags` read-at-load helper against the existing table (no admin UI; toggle directly in Supabase Studio). **Scope-creep guard:** do NOT implement the post-MVP coin-donation feature (DOM-023) behind a flag — the flag scaffolding is the point most likely to invite it.
3. Dynamic OG/Twitter metadata (`generateMetadata`) for the `join/[code]` invite route (team name — UX-023) and the `bet/[id]` share route (title + live odds — UX-024), sourced from real DB records.
4. Baseline public-page SEO (UX-017): the logged-out landing/join/bet pages are server-rendered, semantically marked up, and crawlable — meta tags beyond the two OG cases.
5. Write the free-tier ceilings + scale-up path document (ARC-001/ARC-004) for the future hosted transition: Realtime, DB/storage/auth quotas, and where the design would need to change past them. Documentation only — build nothing (ARC-004).

**Exit criteria:**
- `analytics_events` rows appear for both tracked funnel events during a real signup+invite walkthrough.
- Toggling a `feature_flags` row in Supabase Studio changes app behavior on next load, no deploy.
- Sharing a real bet or invite link renders a correct rich preview from live data (verified via a social-preview debugger); public pages are server-rendered with correct meta/semantic markup.
- The ARC-001/004 document exists in `agent-docs/`.
- **Local-MVP checkpoint: every `[mvp]`-tagged requirement satisfiable on the local backend is done. The single deliberate exception is ARC-012 (hosted dev backend) — a separate, later, owner-ordered transition outside this plan.**

**Sizing:** ~8–10 files; deliberately small since realtime got its own phase; no new tables needed.

## 6. Risks

1. **Google OAuth external dependency (Phase 4):** credentials are created manually in Google Cloud Console, outside agent control. Obtain before the Phase 4 session or it stalls.
2. **Docker/Supabase CLI friction (Phase 3):** environment-specific issues (daemon, ports, versions); low file count undercounts real debugging time.
3. **Realtime debugging (Phase 8):** subscription lifecycle/cleanup/races can consume a full session independent of file count — the reason it is its own phase.
4. **Shared-module reuse discipline (Phases 2, 5, 6, 7):** cascades, validation, and settlement must reuse Phase 1's shared modules; nothing stops a fresh session from re-deriving the logic if it skips reading the referenced files first. Each such session must read `settlement.ts`, `validation.ts`, and `permissions.ts` before writing dependent code.
5. **RLS is a first pass in Phase 3:** Phases 5–7 must budget time to tighten/debug policies against actual access patterns (`SECURITY DEFINER` for kick/ban/injectCoins), not assume Phase 3's are final.
6. **`team-context.tsx` async refactor (Phase 5):** the useMemo-over-static-arrays shape must become query/subscription-driven state with loading/error handling — embedded in Phase 5's tasks and easy to underestimate.
7. **Scope-creep exclusion list (all phases):** coin donation (DOM-023), global team chat (UX-019), native mobile, notifications (ARC-014), pt-BR (UX-027), negative balance, crowd-sourced resolution (DOM-020), and a platform-specific icon set (DOM-010) stay out through all 9 phases.
8. **Fixture consistency (Phase 1):** the mock data's `coinBalance`/`profitLoss`/`balanceAfter` numbers are hand-typed and may not survive the settlement regression check; if they don't, fixing `mock-data.ts` is in scope for Phase 1 — don't bend the pure functions to match wrong fixtures.
9. **§4 decisions are defaults, not spec:** the owner may overrule any open-point resolution (OTP flavor, per-membership grants, kick-cascade semantics, ledger scope). Sessions must follow §4 as written and never silently substitute a different resolution.
10. **Session count vs. sizing tradeoff:** 9 phases is more sessions than the minimum. If the owner prefers fewer sessions over strict single-subsystem sizing, Phases 3+4 or 8+9 can be recombined — at the cost of the exact density problems the judging pass flagged.

## 7. Provenance

Multi-agent run 2026-09-04: 4 parallel code/spec readers → 3 independent roadmap proposals (vertical-slice 80/100, risk-first 76/100, foundation-first 68/100) → adversarial judging → synthesis of the winner with 10 grafts from the runners-up (phase splits for bootstrap/auth and realtime/analytics, settlement-reuse mandates, b-05/b-06 regression check, `state-machine.ts`, permissions migration, OAuth pre-flight, ARC-013 wording, explicit `injectCoins` RPC).

Revision 2026-09-04 (same day), after a 3-agent verification audit (shared package, web app, spec/vision):
- **Factual fixes:** real CONFIG names (`ONBOARDING_GRANT_COINS`/`DAILY_REWARD_COINS`); 6 shared modules, not 5; no test runner exists (vitest setup added to Phase 1); create-bet/wager modals already have client-side gating; delete-team type-to-confirm already exists; "no new migrations" → "no new tables" (RLS tightening IS migrations); free-tier ceilings don't constrain a local stack (rationale moved to the hosted-transition doc).
- **Design reconciliation:** the derived-ledger design contradicted DOM-025/026 and the closed `Transaction["kind"]` union — replaced with spec-literal stored balances + transfer-only ledger (decision §4.6); the onboarding grant moved from Phase 4 (signup — structurally impossible: transactions need a `teamId`, teams were still in-memory) to Phase 5's membership write path (decision §4.2).
- **Citation fixes:** kick/ban is DOM-031/032 (DOM-033/034 are team/bet hard-deletion); resolution is DOM-016/018/019 (not DOM-021/024/025/026); Phase 5/6 goal citations rescoped.
- **Coverage gaps closed:** DOM-011 early close, DOM-027/028/029 standings/podium/badges, DOM-033/034 bet deletion, UX-022 avatar upload + storage bucket, UX-012 deep-link routing (`join/[code]` + `?next=`), UX-017 baseline SEO, UX-028 verification, ARC-001/004 scale docs, ARC-007 session config, ARC-015 schema check; ARC-012 acknowledged as the one `[mvp]` item outside the plan ("local-MVP" checkpoint).
- **New sections:** §4 open-spec-point decisions; phase-numbering trap + standing constraints in "How to use".

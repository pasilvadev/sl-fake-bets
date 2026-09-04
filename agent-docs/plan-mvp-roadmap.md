# SL Fake Bets — Path to MVP Roadmap

Phased execution plan from the current frontend-only prototype to the full `[mvp]` requirement set running against a 100%-local Supabase backend. Produced 2026-09-04 from a multi-agent map → propose (3 angles) → judge → synthesize pass over the codebase, `vision.md`, and `AGENT_SPEC.md`.

**How to use this doc:** each phase below is sized for ONE fresh agent session (roughly ≤ ~15 files / one subsystem). Start a new session per phase; the phase's Goal + Tasks + Exit criteria are written so the session can execute from this doc alone. A phase is done only when every exit criterion is verified. Do not start work from a later phase early.

## 1. Current state (as mapped 2026-09-04)

- `packages/shared` is a well-modeled but purely declarative domain layer: real TypeScript types, one genuinely reusable pure function (`getPoolStats` for pari-mutuel odds), a frozen config, and deterministic mock fixtures — but zero validation, settlement, ledger, permission, or ID-generation logic.
- `apps/web` has real UI plumbing (modal stack, team switching, hydration-safe auth gating, live pari-mutuel math in the wager modal, client-side form validation), but **every mutating action** — create bet, place wager, create team, join by code, kick/ban, delete team, save profile, leave team, resend OTP — is either a dead handler or a submit that just closes its modal. The bet-title link is a literal `href="#"`.
- Auth is a single localStorage boolean (`sl:signed-in`); the "current user" is a hardcoded mock ID; all data comes from one static fixture file. There is no fetch/API/DB layer of any kind.
- `supabase/` is an explicit placeholder (README only), gated by ARC-013.

## 2. MVP definition

MVP is reached when every `[mvp]`-tagged requirement in `AGENT_SPEC.md` runs against a **100%-local** Supabase backend (`supabase start`, no cloud project):

- Real per-device auth (email OTP + Google OAuth).
- Persistent teams, membership, and moderation (kick/ban with wager-cascade refunds, access-mode gating, invite codes).
- Persistent bets and wagers with correct pari-mutuel settlement and a real transaction ledger (onboarding grant, daily reward, leader coin injection, resolution payouts/void refunds — all traceable through `packages/shared`'s pure functions).
- Realtime propagation of new bets/wagers/comments without manual refresh.
- In-house `analytics_events` / `feature_flags` tables (no third-party vendor).
- Dynamic OG/Twitter previews for invite and bet-share links.

Hosting beyond the developer's machine (Supabase Cloud + Vercel — vision's hosted-dev phase) is a **separate, later, owner-gated transition and is out of scope for this plan.**

## 3. When the local backend starts

**Local backend work begins at Phase 3**, immediately after Phases 1–2 have made both frontend-only vertical slices (bet lifecycle; team lifecycle + comments) fully real against in-memory client state, per the vision's frontend-placeholders-first rule (ARC-010). Rationale: a durable per-device identity is the first thing the app structurally cannot fake in memory, and every later phase (persistence, ledger, realtime) depends on real identity and a real schema. Auth is deliberately its own phase (4) so Docker/CLI bootstrap friction and auth-provider friction never compete for one session's budget.

> **ARC-013 gate — read before Phase 3.** Naming Phase 3 as the transition point is **not** the owner's authorization to run it. Before any Phase 3 command (`supabase init`, `supabase start`) executes, the owner must give a separate, explicit, in-the-moment order for that specific transition. Finishing Phases 1–2 does not auto-authorize it. The same gate applies again, separately, to the future hosted-backend transition.

## 4. Phases

### Phase 1 — Bet lifecycle: real logic, in-memory state

**Goal:** make create-bet → wager → resolve fully real (DOM-007, DOM-017, pari-mutuel settlement, DOM-001 leader invariant, BetState transition legality) against client-side in-memory state, before any backend exists. Produces the exact pure functions the backend will call unchanged in Phases 6–7.

**Tasks:**
1. `packages/shared`: add `validation.ts` — `bet.options.length >= 2` (DOM-007), `wager <= maxWagerPerUser` (DOM-017), `wager <=` placing user's `coinBalance`, BetState transition legality (open→closed→resolved only), and DOM-001's exactly-one-leader invariant as its own explicit, named check for reuse anywhere leadership changes hands.
2. `packages/shared`: add `settlement.ts` — given a Bet + its Wagers + a BetResolution, compute payout/refund Transaction rows and updated `coinBalance`/`profitLoss` per member (winner payout via `getPoolStats` pool multiplier; void = full refund; no rake). This is the single function Phase 2's ban/kick cascade and Phase 7's `resolveBet` RPC will both call unchanged.
3. `packages/shared`: add `ledger.ts` — `applyTransaction(member, tx)` reducer + `deriveBalance`/`deriveProfitLoss(userId, transactions)` fold, so balances become a pure function of transaction history instead of hand-typed fixture numbers.
4. `packages/shared`: add `permissions.ts` — `canCreateBet`/`canResolveBet`/`canInvite`/`canManageTeam`/`canKick`/`canBan` derived purely from TeamRole + accessMode + leader flag. Single home for authorization logic (Phase 2 migrates `team-context.tsx`'s inline computation onto it).
5. `packages/shared`: add `state-machine.ts` — `computeEffectiveState(bet, now)` for `closesAt`-driven open→closed auto-transition, plus a guard blocking new wagers once a bet is effectively closed.
6. `packages/shared`: add `id.ts` — bet/wager/transaction id generation + invite-code generation with an explicit uniqueness check (pure, given an existing code set).
7. Regression-check `settlement.ts` against `mock-data.ts`'s own resolved bets (b-05 winner, b-06 void): feed their Bet+Wagers+resolution through the new function and assert output matches the fixture's hand-typed `balanceAfter`/`profitLoss` values.
8. `apps/web/src/lib/team-context.tsx`: convert static mock arrays into real client state (`useReducer`) seeded from mock-data; add mutators `addBet`, `placeWager`, `resolveBet`, `addTransaction` calling the new pure functions.
9. Wire `create-bet-modal.tsx` submit to `addBet` (surface validation errors instead of always enabling submit).
10. Wire `wager-modal.tsx` submit to `placeWager` (block over-balance / over-max / after-effective-close; live-update pool stats after placing).
11. Add a minimal bet-detail route (`apps/web/src/app/bet/[id]/page.tsx`) replacing `bet-row.tsx`'s dead `href="#"`: full bet info + wager list + leader/moderator-gated Resolve control calling `resolveBet`.

**Exit criteria:**
- `pnpm typecheck` and `build` pass.
- Manual flow (no persistence needed): create a bet with ≥2 options (1-option submit blocked), place wagers as the current mock user, resolve it (winner or void), and see balances/profitLoss and the transaction ledger update correctly for every affected member — matching the b-05/b-06 regression check.
- Wagers over balance, over per-user max, or after effective close are blocked in the UI with a visible reason.
- Bet-title link opens a real bet-detail page.

**Sizing:** ~11–13 files (5 new shared modules, `team-context.tsx`, 2 modal submits, 1 new page). One subsystem; no backend/auth mixed in.

### Phase 2 — Team lifecycle & comments: real logic, in-memory state

**Goal:** team creation/joining/moderation/profile-editing and per-bet comments fully real against the same in-memory model — the second and final frontend-only slice before the backend transition.

**Tasks:**
1. `team-context.tsx`: replace inline `canCreateBet`/`canInvite`/`canManage` computation with calls into Phase 1's `permissions.ts` (authorization lives in exactly one place going forward).
2. Extend `team-context.tsx` mutators: `createTeam` (validates single-leader invariant via `validation.ts`), `joinTeamByCode`, `kickMember`/`banMember` (**reusing Phase 1's `settlement.ts` refund path — not a second reimplementation** — to cascade-remove the target's active wagers per DOM-032–034), `updateTeamSettings` (access mode), `deleteTeam`, `updateProfile`, `addComment`, `injectCoins` (leader grants coins; writes a Transaction via `ledger.ts`).
3. Wire `create-team-modal.tsx` submit to `createTeam` and auto-switch to the new team.
4. Wire `team-switcher.tsx` join-by-code form to `joinTeamByCode` (currently a no-op clearing the input).
5. Wire `team-settings-modal.tsx`: access-mode toggle, Inject → `injectCoins`, Kick/Ban, Delete team (post type-to-confirm) to real mutators, gated by `permissions.ts`.
6. Wire `profile-modal.tsx` Save (currently hardcoded disabled) to `updateProfile` (name/avatar/color).
7. Wire `profile-menu.tsx` "Leave team" (currently no handler) to a leave/removeMember action.
8. Add comment posting to the Phase-1 bet-detail page (textarea + submit → `addComment`), rendering mock + new comments (UX-018 shape; no realtime/persistence yet).

**Exit criteria:**
- `pnpm typecheck` and `build` pass.
- Manual flow: create team; join from a second mock user via invite code; leader kicks/bans a member and their roster row + active wagers (refunded via `settlement.ts`) disappear; leader injects coins and recipient's balance + ledger update; access-mode toggle updates `canCreateBet`/`canInvite` gating live; profile edit persists in-session; posting a comment appears immediately.
- No dead-handler buttons remain among: create-team submit, join-by-code, kick/ban, inject, delete-team, profile Save, leave-team.
- Permission values sourced from `permissions.ts`, not recomputed inline.

**Sizing:** ~11–13 files but the densest phase (8 mutators, cascade + gating logic). A fresh session should **read Phase 1's `settlement.ts` and `permissions.ts` first** rather than re-derive their rules.

### Phase 3 — Local backend bootstrap **[LOCAL BACKEND START — owner order required]**

**Goal:** execute the owner-gated transition (ARC-013) at infrastructure level only: Supabase 100% local via CLI+Docker, FULL schema mirroring `packages/shared/src/types.ts` in one pass, RLS scoped to `permissions.ts` rules, local auth providers configured — so Phases 4–9 only add RPCs, tighten policies, and rewire UI against tables that already exist. **Do not run any command in this phase without the owner's separate, explicit, in-the-moment order.**

**Tasks:**
1. `supabase/`: `supabase init` + local Docker config (`supabase start`) — first real content in the directory.
2. Migrations covering the full schema in one pass: `users`, `teams`, `team_members`, `invite_codes`, `bets`, `bet_options`, `wagers`, `transactions`, `comments`, `analytics_events`, `feature_flags` — field-for-field with `types.ts`.
3. RLS policies for every table, scoped to team membership and the role/accessMode rules from `permissions.ts` (user reads/updates only own `users` row; team-scoped tables gated by membership + role).
4. Configure local Supabase Auth providers: email OTP + Google OAuth (dev credentials) — provider config only; no app code changes (auth-context rewrite is Phase 4).
5. Seed script translating `mock-data.ts` fixtures into local Postgres rows (dev-only, reproducible via `supabase db reset`).
6. Minimal `apps/web/src/lib/supabase/client.ts` + `server.ts` with one read-only smoke-test query — nothing else in `apps/web` changes.

**Exit criteria:**
- `supabase start` runs locally; `supabase db reset` applies all migrations cleanly.
- Seeded Postgres reproduces `mock-data.ts`'s teams/bets/wagers/users.
- Manual RLS check: a non-leader cannot resolve a bet or inject coins into another member; a leader can.
- `apps/web` still runs entirely on Phase 1/2 in-memory state, unaffected.

**Sizing:** ~12–14 files, almost entirely SQL/config — which is what makes a full-schema pass safe in one session. Expect Docker/CLI environment friction to consume real time despite the modest file count.

### Phase 4 — Real auth

**Goal:** replace the fake `sl:signed-in` boolean with real Supabase Auth sessions (email OTP + Google OAuth) against Phase 3's schema, giving the app a genuine per-device identity.

**Tasks:**
1. **Pre-flight (outside agent control):** confirm Google OAuth dev credentials exist in Google Cloud Console *before* starting the session — missing credentials can stall the whole phase.
2. Rewrite `apps/web/src/lib/auth-context.tsx` to hold a real Supabase session (server+client via `@supabase/ssr`).
3. Add `app/auth/callback/route.ts`; wire `auth-page.tsx`'s email OTP request/verify flow, the Google OAuth button, and the previously-inert "Resend code" button.
4. Wire `app-gate.tsx` gating to the real session, preserving its hydration-safe (null-until-mount) pattern.
5. Fire the onboarding-grant Transaction (`CONFIG.onboardingGrant`) exactly once on first real signup into Phase 3's `transactions` table; verify idempotent on repeat sign-in.
6. Retire `mockCurrentUserId` for auth purposes only — team/bet/wager data still runs on Phase 1/2 in-memory state.

**Exit criteria:**
- Real user signs up via email OTP locally and the session survives reload; Google OAuth works against local dev config.
- Exactly one onboarding-grant transaction row per real signup, idempotent on repeat sign-in.
- AppGate gates on the real session; Phase 1/2 flows still run on in-memory state.

**Sizing:** ~7–9 files, auth-only. Kept separate from bootstrap so two friction-prone concerns (Docker infra, external auth providers) never share a session.

### Phase 5 — Team & membership persistence

**Goal:** teams, membership, roles, invites, and the team-scoped ledger write path (DOM-005/006, UX-005/012) become real Postgres data behind real auth, replacing Phase 2's in-memory team mutators.

**Tasks:**
1. Server actions/RPC: `createTeam`, `joinTeamByCode` (using `id.ts` uniqueness check), `kickMember`/`banMember` (cascading wager removal **via Phase 1's `settlement.ts` refund path — reuse, don't reimplement**), `updateTeamSettings`, `deleteTeam` (type-to-confirm), `injectCoins` (writes a `transactions` row via `ledger.ts`).
2. Tighten Phase 3's provisional RLS for `teams`/`team_members`/`invite_codes`/`transactions` now that real access patterns exist (e.g. `SECURITY DEFINER` functions for kick/ban/injectCoins so a member cannot self-grant or self-promote).
3. Rewire `team-context.tsx` from the local reducer to Supabase queries on mount + the new RPCs for mutation, keeping permission derivation via `permissions.ts`. **Note:** this is the useMemo-over-static-arrays → query-driven-state refactor (loading/error handling included) — budget for it explicitly.
4. Rewire `create-team-modal`, `team-switcher` (list + join), `invite-modal` (real `invite_codes` row instead of `team.inviteCode` mock), `team-settings-modal` (incl. Inject), `profile-menu` leave-team, `profile-modal` save.

**Exit criteria:**
- `pnpm typecheck`/`build` pass; local Supabase running.
- Two real authenticated users (e.g. two browser profiles): A creates a team with a real unique invite code; B joins via code and appears in the roster; A kicks B and membership + active wagers vanish (refunded via `settlement.ts`); A injects coins and the member's balance/ledger updates.
- Restarting dev server / Supabase and reloading shows the same state (durable persistence).

**Sizing:** ~10–12 files; no new migrations (Phase 3 created every table this phase writes).

### Phase 6 — Bet & wager persistence

**Goal:** bets, options, and wagers (DOM-013/014/016) become real Postgres data scoped to real teams, replacing Phase 1's in-memory bet/wager state; live pool stats come from real rows.

**Tasks:**
1. Server actions/RPC: `createBet`, `placeWager` — reusing `validation.ts` and `state-machine.ts` (`closesAt` gating) as the single source of truth, not reimplemented in SQL.
2. Tighten Phase 3's provisional RLS for `bets`/`bet_options`/`wagers` scoped to team membership.
3. Rewire `create-bet-modal`, `wager-modal`, `bet-feed`, `bet-row`, and the bet-detail page's read/wager UI to Supabase.
4. `getPoolStats` now runs against live DB-fetched wagers.

**Exit criteria:**
- `pnpm typecheck`/`build` pass.
- Two real users on a shared team: A creates a bet, B places a wager; displayed odds/pool totals match `getPoolStats` computed from DB rows.
- Data survives server restart; over-balance / over-max / after-close wagers rejected **server-side**, not just client-side.

**Sizing:** ~10–12 files. Resolution/ledger deliberately deferred to Phase 7 to stay under budget.

### Phase 7 — Resolution, ledger & daily rewards

**Goal:** resolving a bet actually pays out (DOM-021/022/024/025/026); balances become derived from a real transaction ledger; daily reward becomes a real idempotent grant.

**Tasks:**
1. Server action/RPC `resolveBet` reusing `settlement.ts` (winner payout by pool multiplier; void = full refund) — writes transaction rows and updates derived balances atomically.
2. Idempotent daily-reward issuance (`CONFIG.dailyReward`) — once per calendar day per user, checked on load or via scheduled function.
3. View/derivation computing `coinBalance`/`profitLoss` from the transaction table via `ledger.ts` — no redundantly stored balances remain.
4. Rewire the Phase-1 resolve control, `wallet-module`, and `transactions-modal` to real data; persist bet-detail comments (from Phase 2) to Phase 3's `comments` table.

**Exit criteria:**
- `pnpm typecheck`/`build` pass.
- Leader resolves a bet with real wagers from multiple real users; winners' balances/profitLoss and the ledger update correctly and survive restart; void resolution fully refunds every wagerer.
- Daily reward grants exactly once per user per calendar day (attempt twice in one day to verify).
- Comments persist across reload for all team members.

**Sizing:** ~10–12 files. Last purely-backend-logic phase before realtime/polish.

### Phase 8 — Realtime propagation

**Goal:** close the liveness gap (ARC-005/UX-013): bets, wagers, and comments propagate to other online team members without manual refresh, using **coarse-grained** Supabase Realtime subscriptions only.

**Tasks:**
1. Coarse-grained subscriptions only: one per-team channel for the bet list, one per-bet-page channel for wager/comment updates (Postgres Changes/Broadcast), respecting the 200-connection / 2M-msg free-tier ceilings.
2. Wire `team-context.tsx` and the bet-detail page to live-update on relevant INSERT/UPDATE events.
3. Subscription lifecycle: subscribe once per mounted team/bet context; tear down cleanly on unmount/team switch; guard races between a just-arrived realtime event and an in-flight manual refetch.
4. Verify channel-count discipline in the local Realtime inspector matches the coarse granularity (per team/bet-list/bet-page — never per-row/per-field).

**Exit criteria:**
- Two real browser sessions in the same team see a new bet, an updated pool multiplier from another user's wager, and a new comment appear live with no refresh.
- Rapid team switching produces no duplicate/ghost subscriptions or updates.
- Realtime inspector channel count matches the coarse-grained design.

**Sizing:** ~8–10 files. Own phase because subscription lifecycle/cleanup/races can plausibly consume a full session alone.

### Phase 9 — Analytics, feature flags & sharing polish **[MVP-COMPLETE]**

**Goal:** close the remaining `[mvp]` items that only make sense with real data/traffic: in-house analytics + feature flags (ARC-016/017) and real SEO/social previews (UX-017/023/024).

**Tasks:**
1. Instrument the two specified funnel points into the existing `analytics_events` table: onboarding per-step drop-off; invite-open → signup conversion.
2. Simple `feature_flags` read-at-load helper against the existing table (no admin UI; toggle directly in Supabase Studio). **Scope-creep guard:** do NOT implement the post-MVP coin-donation feature behind a flag — the flag scaffolding is the point most likely to invite it.
3. Dynamic OG/Twitter metadata (`generateMetadata`) for invite links (team name) and bet-share links (title + live odds), sourced from real DB records.

**Exit criteria:**
- `analytics_events` rows appear for both tracked funnel events during a real signup+invite walkthrough.
- Toggling a `feature_flags` row in Supabase Studio changes app behavior on next load, no deploy.
- Sharing a real bet or invite link renders a correct rich preview from live data (verified via a social-preview debugger).
- **All `[mvp]`-tagged requirements satisfied against the local backend — MVP-complete checkpoint.** Hosting (Supabase Cloud/Vercel) is a separate, later, owner-ordered transition outside this plan.

**Sizing:** ~7–9 files; deliberately small since realtime got its own phase; no new tables needed.

## 5. Risks

1. **Google OAuth external dependency (Phase 4):** credentials are created manually in Google Cloud Console, outside agent control. Obtain before the Phase 4 session or it stalls.
2. **Docker/Supabase CLI friction (Phase 3):** environment-specific issues (daemon, ports, versions); low file count undercounts real debugging time.
3. **Realtime debugging (Phase 8):** subscription lifecycle/cleanup/races can consume a full session independent of file count — the reason it is its own phase.
4. **Settlement reuse discipline (Phases 2 & 5):** kick/ban cascades must reuse Phase 1's `settlement.ts`; nothing stops a fresh session from re-deriving refund logic if it skips reading the referenced file first. Each such session must read `settlement.ts` before writing cascade code.
5. **RLS is a first pass in Phase 3:** Phases 5–7 must budget time to tighten/debug policies against actual access patterns (`SECURITY DEFINER` for kick/ban/injectCoins), not assume Phase 3's are final.
6. **`team-context.tsx` async refactor (Phase 5):** the useMemo-over-static-arrays shape must become query/subscription-driven state with loading/error handling — embedded in Phase 5's tasks and easy to underestimate.
7. **Scope-creep exclusion list (all phases):** coin donation, global team chat, native mobile, notifications, pt-BR, negative balance, crowd-sourced resolution stay out through all 9 phases.
8. **Session count vs. sizing tradeoff:** 9 phases is more sessions than the minimum. If the owner prefers fewer sessions over strict single-subsystem sizing, Phases 3+4 or 8+9 can be recombined — at the cost of the exact density problems the judging pass flagged.

## 6. Provenance

Multi-agent run 2026-09-04: 4 parallel code/spec readers → 3 independent roadmap proposals (vertical-slice 80/100, risk-first 76/100, foundation-first 68/100) → adversarial judging → synthesis of the winner with 10 grafts from the runners-up (phase splits for bootstrap/auth and realtime/analytics, settlement-reuse mandates, b-05/b-06 regression check, `state-machine.ts`, permissions migration, OAuth pre-flight, ARC-013 wording, explicit `injectCoins` RPC).

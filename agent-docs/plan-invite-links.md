# SL Fake Bets — Invite Links Plan: expiry choice & revocation

Closes **open decision #6** (`AGENT_SPEC.md` §6 — "Invite link manual revocation")
and amends **UX-005 / DOM-005** ("invites never expire by time") on an owner
order. Owner request, 2026-09-07, stated in chat: *implement expiration of
invite links; the user should be able to choose whether an invite is permanent
(no expiration) or expires in 24 hours; build the UI; wire invite revocation.*

**The pillar survives.** `vision.md` says *"tentar ao maximo não expirar links
de convite"* — try as hard as possible not to expire invite links. Nothing in
this plan expires a link that nobody asked to expire: every team is still born
with a permanent link, that link is still the default, and a 24-hour link only
exists when a person chose that option for that one link. The amendment adds a
per-link choice; it does not change what happens by default.

---

## 0. Scope, in one paragraph

`invite_codes` gains a nullable `expires_at`; `NULL` means permanent. A team
holds **at most one live permanent link** and up to ten live 24-hour links.
Anyone `canInvite` allows (DOM-006 — the team's access mode) can mint either
kind from the invite modal, which becomes a small link manager: the list of
live links (kind, countdown, copy, revoke) plus a "new link" composer with a
two-way choice. Revocation is a per-link action for the leader, moderators,
and whoever made that link. Expiry is lazy in the DUEL-008 shape — every read
already filters it, nothing is scheduled, and there is no money to refund so no
sweep exists. Both writes are SECURITY DEFINER RPCs and the direct client writes
on `invite_codes` are withdrawn, completing the Phase 5 tightening for the one
table it left open. Ship order matters: the migration reaches production
**before** the code does, because the new modal calls functions the old schema
does not have.

---

## 1. Read first

**Docs.** `AGENT_SPEC.md` §4.1 UX-005, UX-023, UX-029; §4.2 DOM-005, DOM-006;
§4.4 DUEL-008 (the lazy-expiry pattern this copies); §6 item 6.
`design-visual-identity.md` §5.3 (buttons — *one* jade primary per screen, and
the two destructive variants), §5.4 (modals), §5.8 (forms), §5.9 (toasts), §5.10
(empty states), §7 (voice), §7.1 (writing the Portuguese). `design-dashboard.md`
§1.1 item 2 (the invite modal's place in the shell). `plan-mvp-roadmap.md` §8
Extra Phase 2 decision D8 and task 9 (lazy expiry; the anti-spam cap as "rate
control, not moderation"). `plan-i18n-ptbr.md` D8/D9 (codes not sentences; no
matching on Postgres message text — SQLSTATE only). `plan-hosted-early-access.md`
D3 (the guarded prod push) and §4/§5 Phase 3 (how a migration reached prod
last time). `supabase/README.md` §Hosted in full.

**Code — SQL.** `20260905120000_domain_schema.sql:122-138` (the table, its
"no expiry column by design" comment, and the one-active-per-team partial
index this plan replaces). `20260905120400_rls_policies.sql:144-167` (the three
`invite_codes` write policies that go) and the grants block at `:322-335`.
`20260905140000_team_rpcs.sql` in full — `app.require_uid` (`:97`),
`create_team` (`:117-144`, untouched), `team_preview_by_code` (`:152-173`) and
`join_team_with_code` (`:182-213`) are re-created with one extra predicate
each (no later migration re-creates either — these ARE the latest bodies); the
"What stays a direct client write" list at `:373-378` names `invite_codes` and
is superseded. `20260906130400_duel_pair_rule_fix.sql:107-140`
(`enforce_duel_pending_cap` — the named-SQLSTATE convention `SLD01`/`SLD02`
that `SLI01`/`SLI02` follow). `20260905120200_auth_helpers.sql` for
`app.is_team_member` (`:29`), `app.is_moderator_or_leader` (`:60`),
`app.can_create_bet` (`:67`, which implies membership). `20260906130000_duel_schema.sql:345-360`
(the `bet_duels` grant-then-revoke that D4 copies exactly).
`scripts/supabase-privilege-audit.sql` — its header explains how "expected" is
derived; the CTEs are `table_exceptions`, `function_exceptions`,
`roster_functions`; the `rls_rows` CTE only checks RLS-enabled and
`policy_count >= 1`, never policy names. Every grant change here needs a row
there.

**Code — TypeScript.** `packages/shared/src/types.ts:143-156` (`Team.inviteCode`,
the scalar that becomes a list), `permissions.ts:34-37` and `:88-95`
(`canInvite`, `canJoinTeam`), `config.ts` (the duplicated-constant warning
shape every tunable carries), `errors.ts` (the `MutationErrorCode` union),
`id.ts` (`generateInviteCode`), `mock-data.ts:66-70,126-129,140-143`.
`apps/web/src/lib/data/team-data.ts:140-143,516,543,557-559,578` (the
`invite_codes` read and the `Team` mapping), `team-mutations.ts:44-56`
(`createTeam`'s 23505 retry loop, reused) and `bet-mutations.ts`'s
`asDuelFailure` (SQLSTATE → code, the shape `asInviteFailure` copies),
`team-context.tsx:391-400` (`TeamState`'s mutation members), `:2584-2605`
(`joinTeamByCode`'s local `inviteCode` check), `:2676-2697`
(`updateTeamSettings` — the `requireContext` → permit → db → return idiom).
`components/modals/invite-modal.tsx` (rewritten), `team-settings-modal.tsx`
(`MemberRow`'s inline-confirm-then-run pattern and its destructive toast — the
revoke row copies both), `components/join/join-page.tsx` and
`app/join/[code]/page.tsx` (no code change; copy only), `lib/use-now.ts` and
`lib/format.ts`'s `formatTimeLeft` (the countdown), `i18n/messages.ts` (why a
missing key in either catalog fails `pnpm typecheck`).

---

## 2. Current state — audited 2026-09-07

| Fact | Where |
|---|---|
| `invite_codes(id, team_id, code unique, created_by, created_at, revoked_at)`; **no `expires_at`**, by a comment that cites UX-005/DOM-005 | `domain_schema.sql:124-133` |
| Partial unique index: **one non-revoked code per team** | `domain_schema.sql:136-138` |
| `revoked_at` exists and is honoured by both RPCs and the client read — but **nothing ever sets it**; there is no revoke path in the app | `team_rpcs.sql:175,193`; `team-data.ts:516` |
| RLS: SELECT for members; INSERT per access mode; UPDATE/DELETE for mod/leader; all four verbs granted to `authenticated` (and, by Supabase's default privileges, to `anon`) | `rls_policies.sql:144-167,324` |
| `create_team` inserts the team's one code; `team_preview_by_code` (anon+authenticated) and `join_team_with_code` filter `revoked_at is null` only | `team_rpcs.sql` |
| `Team.inviteCode: string`; the client keeps the first non-revoked code per team | `types.ts:146`; `team-data.ts:557-559` |
| Invite modal: preview card + one read-only URL + Copy; footer literally says "Revoke/regenerate — future." | `invite-modal.tsx`; `messages/en.json` `inviteModal.revokeFuture` |
| Invite entry points gate on `canInvite` (top bar, profile menu, team module) — a viewer of the modal always holds `canInvite` | `top-bar.tsx:59`, `profile-menu.tsx:70`, `team-module.tsx:47` |
| The join page says "codes don't expire, but they can be revoked"; the OG description is the shorter "This invite code doesn't match any team." — both get new text | `en.json:572` `joinPage.noTeam`; `en.json:99` `metadata.inviteNotFoundDescription` |
| `invite_codes` is **not** in the realtime publication | `20260905190000_realtime_publication.sql` |
| Last migration applied to dev and prod: `20260907140000_analytics_events_size_check.sql` | `supabase/README.md`, `plan-hosted-early-access.md` Phase 3 |
| `pnpm test` runs vitest in `packages/shared` only; `apps/web` has no test runner | `packages/shared/package.json` |

---

## 3. Decisions this plan takes (owner may overrule)

- **D1 — Two kinds of link, one column.** `expires_at timestamptz` nullable on
  `invite_codes`; `NULL` is permanent. No enum, no `kind` column: "temporary"
  is exactly "has an expiry", and a second column would let the two disagree.
  The partial unique index becomes **one live permanent link per team**
  (`where revoked_at is null and expires_at is null`); temporary links are not
  in it.
- **D2 — 24 hours is the only temporary duration, and the server sets it.**
  `create_invite_code` writes `expires_at = now() + app.invite_temporary_ttl()`;
  no client value is ever accepted for it (a client with a wrong clock could
  otherwise mint a link that dies in the past or lives for years). The
  TypeScript twin `CONFIG.INVITE_TEMPORARY_TTL_HOURS = 24` exists to write the
  sentence and carries the same HARD WARNING as `DUEL_ACCEPT_WINDOW_HOURS`: the
  SQL function is the authority; change both or neither.
- **D3 — Expiry is lazy and needs no sweep** (DUEL-008's shape, minus the half
  it does not need). Every read predicate becomes `revoked_at is null and
  (expires_at is null or expires_at > now())` — in `team_preview_by_code`,
  `join_team_with_code`, and the client's `isInviteLive(invite, now)`. Nothing
  is scheduled, no `pg_cron` job is added, and unlike a duel there is nothing to
  refund, so there is no persisting sweep either: an expired row is simply a row
  no read returns. The client filters by **its own clock at render time**
  (`useNow`), which is the same trade every countdown in the app already makes;
  the RPCs are the truth and refuse an expired code regardless of what a stale
  screen shows.
- **D4 — Both writes are RPCs; the direct client writes on `invite_codes` are
  withdrawn.** `public.create_invite_code(p_team_id, p_code, p_temporary)` and
  `public.revoke_invite_code(p_invite_id)`. Three reasons, any one sufficient:
  D2 (the expiry must come from the server clock); the one-permanent rule and
  the cap (D6) need to be checked in the same transaction as the insert; and
  `team_rpcs.sql`'s tightening left `invite_codes` as the one domain table a
  client could still write directly *because* nothing needed to — that reason
  is gone. The three write policies are dropped and `insert, update, delete,
  truncate` are revoked from `authenticated` **and** `anon` (the exact
  belt-and-braces statement `duel_schema.sql:360` used for `bet_duels`).
  SELECT stays as it is.
- **D5 — Who may do what.** *Create* either kind: `canInvite` (DOM-006 — the
  access mode), enforced by `app.can_create_bet` in the RPC exactly as the old
  INSERT policy did. *Revoke*: the leader, any moderator, **or the member who
  made that link** — a person may unmake what they made, and in a free-for-all
  team most 24-hour links will be made by ordinary members. The creator must
  still be on the roster (`app.is_team_member`); someone who left keeps no
  power over the team. `permissions.ts` gains `canRevokeInvite(team, userId,
  invite)` and the RPC mirrors it, as every rule in that file is mirrored.
  *Read*: any member sees every live link (the SELECT policy is unchanged);
  copying a teammate's link is not a privilege, it is the point of a link.
- **D6 — At most 10 live 24-hour links per team.** Rate control, not
  moderation (Extra Phase 2 task 9's sentence applies verbatim — this bounds
  volume and says nothing about content). Enforced inside the RPC with SQLSTATE
  `SLI02` and pre-checked on the client with the same number
  (`CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM`, SQL twin
  `app.invite_max_live_temporary_per_team()`). **No trigger**, deliberately:
  the duel cap needed one because a second write path could exist; after D4 the
  RPC is the only writer, so a trigger would fire only for service contexts,
  which it would exempt. A concurrent pair of creates can overshoot by one;
  for a cap on convenience that is fine and is written down here so nobody
  "fixes" it with a lock.
- **D7 — `Team.inviteCode` becomes `Team.invites: TeamInvite[]`.** One
  representation, not a scalar plus a list that can disagree. The list holds
  every **non-revoked** row (revocation is the database's fact); expiry is
  applied by the shared selectors with an injected `now`, never at load time,
  so a modal left open shows a link dying at the right moment instead of
  showing a stale list until the next reload. Blast radius is small and
  enumerated in Phase 2/3: `types.ts`, `mock-data.ts` (3 teams),
  `duel.test.ts`'s fixture, `team-data.ts`, `team-context.tsx:2592`,
  `invite-modal.tsx`.
- **D8 — A second permanent link is refused, not silently regenerated.**
  Choosing "Permanent" while a live permanent exists is disabled in the UI with
  the reason, and the RPC raises `SLI01` if asked anyway. "Regenerate" is two
  explicit actions — revoke, then create — because a one-click regenerate
  destroys a link people may have already pasted somewhere, and this codebase
  confirms destructive actions inline every single time (kick, ban, delete).
- **D9 — Team creation still mints a permanent link.** `create_team` is not
  touched. A team is never born without a link (UX-001/UX-029: the first thing
  a founder does is invite), and `expires_at` defaults to `NULL`, so the
  existing INSERT already writes a permanent one.
- **D10 — No realtime for `invite_codes`.** `design-realtime.md`'s rule is one
  coarse channel per team carrying what the dashboard renders live; the invite
  modal is neither on the dashboard nor live-critical. Own mutations `reload()`
  (the idiom `joinTeamByCode` already uses); a teammate's revocation is seen on
  the next load, and the RPCs refuse a revoked code either way.
- **D11 — Ship order: schema to prod first, code second — both owner steps.**
  The new modal calls `create_invite_code`/`revoke_invite_code` and reads
  `expires_at`; deployed before the migration it would fail on open. So:
  `pnpm db:push:prod` (types the word `prod` at the guard — a human step by
  design, D3 of the hosted plan), **then** `git push` (Vercel builds `main`
  as production). Agents commit on `main` and never push — standing rule.
  The old code keeps working against the new schema in between (it selects
  columns that still exist and calls RPCs that still exist), so the window is
  safe in that direction only.
- **D12 — Spec amendment, not deprecation.** UX-005 and DOM-005 are amended in
  place with a strikethrough-and-replace, as UX-002 was for the hosted plan's
  D8 carve-out: *permanent by default, no automatic expiry ever applied to a
  link nobody chose to expire; an opt-in 24-hour link; manual revocation by
  leader, moderators, or the link's creator.* Open decision #6 is marked
  resolved. `vision.md` is not edited (the doc protocol forbids it), and the
  reasoning in this file's preamble is why the pillar is judged intact.

---

## 4. Phases

Every phase is agent work except Phase 7. Rules that bind every agent on this
plan: Sonnet models only; commit on `main`, **never push**; never run
anything against prod — `.env.ops` is loaded with `set -a; source .env.ops;
set +a` and never echoed; the Supabase CLI is linked to **dev** and bare
`db push` lands there; no new dependencies; a `next dev` an agent starts is a
`next dev` that agent stops (`pkill -f "next dev"; pkill -f "next-server"`);
`pnpm typecheck && pnpm lint && pnpm test` must be green before any commit.

### Phase 1 — Schema and RPCs

**Goal:** one migration that adds the column, replaces the index, re-creates the
two read RPCs with the expiry predicate, adds the two write RPCs, withdraws the
direct writes, and updates the audit script to match. Applied to dev in Phase 5.

**Tasks:**

1. **Migration `supabase/migrations/20260907150000_invite_links.sql`** (must
   sort after `20260907140000`, the last one applied to both projects). Header
   comment: what it supersedes (`domain_schema.sql`'s "no expiry column by
   design", `team_rpcs.sql`'s "What stays a direct client write" entry for
   `invite_codes`), the owner order and date, and D1–D6 in two sentences each.
2. **Column and constraint.** `alter table public.invite_codes add column
   expires_at timestamptz;` then `add constraint invite_codes_expiry_after_creation
   check (expires_at is null or expires_at > created_at)`. `comment on column`:
   `NULL = permanent (UX-005 default). Set only by create_invite_code from
   app.invite_temporary_ttl(); never from a client clock.`
3. **Index.** `drop index public.invite_codes_one_active_per_team_idx;` then
   `create unique index invite_codes_one_live_permanent_per_team_idx on
   public.invite_codes (team_id) where revoked_at is null and expires_at is null;`.
   Also `create index invite_codes_team_live_idx on public.invite_codes
   (team_id) where revoked_at is null` for the per-team list and the cap count.
4. **Tunables in `app`**, in the shape of `app.duel_accept_window()`:
   `app.invite_temporary_ttl() returns interval` → `interval '24 hours'`, and
   `app.invite_max_live_temporary_per_team() returns integer` → `10`. Each
   carries the "this is the authority; `CONFIG.*` is the copy" comment.
5. **Re-create `team_preview_by_code(p_code text)` and
   `join_team_with_code(p_code text)`** with `create or replace`, bodies copied
   verbatim from `team_rpcs.sql` plus **one added predicate each**:
   `and (c.expires_at is null or c.expires_at > now())`. Same signatures, same
   return types, same `security definer stable`/`plpgsql` shapes, so existing
   grants persist — verify that assumption in Phase 5 with the audit rather
   than assuming it. Update `join_team_with_code`'s header sentence that cites
   "UX-005 (codes never expire)".
6. **`public.create_invite_code(p_team_id uuid, p_code text, p_temporary boolean)
   returns uuid`**, `language plpgsql security definer set search_path = ''`:
   `v_uid := app.require_uid()`; if not `app.can_create_bet(p_team_id)` →
   `raise exception 'Only members the access mode allows can make invite links
   for this team.' using errcode = 'insufficient_privilege'`; blank code →
   `check_violation` (same sentence `create_team` uses); if `not p_temporary`
   and a live permanent exists → `raise exception 'This team already has a
   permanent link — revoke it to make a new one.' using errcode = 'SLI01'`; if
   `p_temporary` and `count(*)` of live temporary rows `>=
   app.invite_max_live_temporary_per_team()` → `raise exception 'This team
   already has % live 24-hour links. Revoke one or wait for one to expire.'
   using errcode = 'SLI02'`; then `insert (team_id, code, created_by,
   expires_at) values (p_team_id, btrim(p_code), v_uid, case when p_temporary
   then now() + app.invite_temporary_ttl() end) returning id`. A code
   collision still surfaces as `23505`, which the client retry loop already
   handles; a concurrent second permanent also lands as `23505` on the index,
   and the retry's next attempt hits `SLI01` — self-correcting, note it in the
   comment.
7. **`public.revoke_invite_code(p_invite_id uuid) returns void`**, same shape:
   read `team_id, created_by, revoked_at` for the id (definer, so RLS does not
   hide it); not found → `no_data_found` "That invite link no longer exists.";
   not `app.is_team_member(team_id)` → `insufficient_privilege` "You are not a
   member of this team."; not (`app.is_moderator_or_leader(team_id)` or
   `created_by = v_uid`) → `insufficient_privilege` "Only the leader, a
   moderator, or whoever made a link can revoke it."; already revoked →
   `return` (idempotent — two tabs, one click each, one row); else
   `update … set revoked_at = now()`.
8. **Grants.** `revoke execute on function public.create_invite_code(uuid, text,
   boolean), public.revoke_invite_code(uuid) from public, anon;` and `grant
   execute … to authenticated;`. The role-named `anon` revoke is what the audit
   header says is needed — `from public` alone does not strip Supabase's
   default named grant.
9. **Withdraw the direct writes** (D4), in the tightening style at the end of
   `team_rpcs.sql`: `drop policy if exists invite_codes_insert_per_access_mode`,
   `…_update_moderator_or_leader`, `…_delete_moderator_or_leader` on
   `public.invite_codes`; `revoke insert, update, delete, truncate on
   public.invite_codes from authenticated, anon;` (verbatim the `bet_duels`
   statement at `duel_schema.sql:360`). Say in the comment that SELECT is
   untouched and why (D5, read).
10. **`scripts/supabase-privilege-audit.sql`.** Add the migration key (`inv =
    20260907150000_invite_links.sql`) to the header; six rows to
    `table_exceptions` (`invite_codes` × `authenticated`/`anon` × `insert`/
    `update`/`delete`, note `inv: create_invite_code/revoke_invite_code own
    every write`); the four new functions to `roster_functions` (`app.invite_
    temporary_ttl ''`, `app.invite_max_live_temporary_per_team ''`,
    `public.create_invite_code 'p_team_id uuid, p_code text, p_temporary
    boolean'`, `public.revoke_invite_code 'p_invite_id uuid'`); `anon` →
    `execute` → false rows in `function_exceptions` for the two `public` ones
    (the `app` tunables keep the default grants, like every other `app`
    helper). The `rls_rows` CTE checks only that RLS is on and at least one
    policy exists — `invite_codes` keeps its SELECT policy, so nothing to do
    there.
11. **`supabase/seed.sql`.** Existing three rows gain nothing (their
    `expires_at` is `NULL` = permanent). Add three demo rows for team 1
    (`10000000-…-0001`) so every filter has a row to exercise on dev:
    `70000000-…-0004` temporary and live (`created_at now()`, `expires_at
    now() + interval '20 hours'`, `created_by` Duds `…-0002`); `…-0005`
    temporary and expired (`created_at now() - interval '2 days'`, `expires_at
    now() - interval '1 day'`); `…-0006` permanent and revoked (`created_at
    '2026-07-01T12:00:00Z'`, `revoked_at '2026-07-02T12:00:00Z'`). Codes:
    `originals-day-pass`, `originals-stale-pass`, `originals-old-link`. The
    seed's id-block comment at the top gains the new range. `now()`-relative
    values are deliberate and the comment must say so: the row has to be live
    whenever `db reset` runs, which fixed dates cannot promise.
12. **`supabase/README.md`** — one row in the migrations table.

**Exit criteria:** the migration applies cleanly on dev (Phase 5 task 2) and the
audit prints zero rows; `select * from team_preview_by_code('originals-stale-pass')`
returns nothing while `…('originals-day-pass')` returns team 1.

### Phase 2 — Shared package (`packages/shared`)

**Tasks:**

1. **`types.ts`.** `export interface TeamInvite { id: string; code: string;
   createdBy: string | null; createdAt: string; /** ISO, or null = permanent
   (D1). */ expiresAt: string | null; }`. On `Team`: replace `inviteCode:
   string` with `/** Every non-revoked link (D7); apply `isInviteLive` for
   expiry. */ invites: TeamInvite[]`. Update the doc comment that cites
   UX-005/DOM-005.
2. **`config.ts`.** `INVITE_TEMPORARY_TTL_HOURS: 24` and
   `INVITE_MAX_LIVE_TEMPORARY_PER_TEAM: 10`, each with the duplicated-constant
   HARD WARNING in the exact register of `DUEL_ACCEPT_WINDOW_HOURS` and
   `DUEL_MAX_PENDING_PER_CHALLENGER`, naming the SQL twin by function name.
3. **New `invites.ts`**, pure and `now`-injected like `state-machine.ts`:
   `isInviteLive(invite, now: number)`; `liveInvites(team, now)` — permanent
   first, then by `expiresAt` ascending; `permanentInvite(team, now)`;
   `liveTemporaryInvites(team, now)`; `inviteCreationBlocker(team, now,
   temporary): "invite-permanent-exists" | "invite-temp-cap" | null` (D6/D8's
   client half). Export from `index.ts`.
4. **`permissions.ts`.** `canRevokeInvite(team, userId, invite)` =
   `isModeratorOrLeader(team, userId) || (isMember(team, userId) &&
   invite.createdBy === userId)` with the D5 comment and the SQL-mirror line
   every function in that file carries.
5. **`errors.ts`.** Four codes under `// --- authorization ---`:
   `manager-only-invite`, `creator-or-mod-only-revoke-invite`; and under a
   new `// --- invite links (plan-invite-links.md) ---` group:
   `invite-permanent-exists`, `invite-temp-cap` (interpolates `{max}`).
6. **`mock-data.ts`.** Each of the three teams: `invites: [{ id, code,
   createdBy: <leader>, createdAt: <team createdAt>, expiresAt: null }]` using
   the seed's `70000000-…-000N` ids and the existing codes. Team 1 also gets
   the temporary demo link `{ id: "70000000-…-0004", code: "originals-day-pass",
   createdBy: "u-02", createdAt: "2026-08-01T18:00:00Z", expiresAt:
   "2026-08-02T18:00:00Z" }` — fixed dates, because tests inject `now`; the
   seed's `now()`-relative twin is explained in Phase 1 task 11.
7. **`duel.test.ts`** fixture at `:101`: `inviteCode: "duel-club"` →
   `invites: [{ … code: "duel-club", expiresAt: null }]`. Any other compile
   error from the type change is fixed the same way, not by loosening the type.
8. **Comments.** `id.ts:2-6` and `validation.ts:322` cite "codes never
   expire"; reword to cite D1/D3 of this plan (uniqueness still spans revoked
   and expired rows, so the code set still only grows — that half stays true).
9. **New `invites.test.ts`** (vitest, beside the others): `isInviteLive` for
   null / future / past / exactly-now; `liveInvites` ordering with a mixed
   fixture; `inviteCreationBlocker` for permanent-exists, cap reached (build
   ten live temporaries), and the two allowed cases; `canRevokeInvite` for
   leader, moderator, creator-who-is-a-member, creator-who-left, stranger.
   `team-lifecycle.test.ts` keeps passing unchanged (its `teamAs` spreads
   `mockTeam`).

**Exit criteria:** `pnpm --filter @repo/shared typecheck && pnpm --filter
@repo/shared test` green; `apps/web` typecheck is *expected* red until Phase 3.

### Phase 3 — Web data layer and context (`apps/web/src/lib`)

**Tasks:**

1. **`data/team-data.ts`.** `InviteCodeRow` becomes `{ id, team_id, code,
   created_by: string | null, created_at, expires_at: string | null }`; the
   query selects those columns, still `.is("revoked_at", null)`; group rows by
   team into `invites` (permanent first, then `expires_at` asc, then
   `created_at`) and map with a `toInvite`; `Team.invites` replaces
   `inviteCode`. Replace the "reproduces the `Team.inviteCode` scalar" comment
   and the header's sentence about `Team.inviteCode` with D7.
2. **`data/team-mutations.ts`.** Extract `createTeam`'s five-attempt `23505`
   loop into `withFreshCode(attempt: (code) => Promise<{data, error}>)` and use
   it from both `createTeam` and the new `createInviteCode(supabase, { teamId,
   temporary }): Promise<MutationResult & { inviteId?: string }>` (RPC
   `create_invite_code`). Add `asInviteFailure(error)` keyed on SQLSTATE only
   — `SLI01` → `fail("invite-permanent-exists")`, `SLI02` →
   `fail("invite-temp-cap", { values: { max:
   CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM } })`, anything else →
   `unexpected(error)` — in the shape of `bet-mutations.ts`'s
   `asDuelFailure`, with D9's "never the message text" sentence. Add
   `revokeInviteCode(supabase, inviteId): Promise<MutationResult>` (RPC
   `revoke_invite_code`; every failure → `unexpected`). Update the header
   list of what is an RPC and what is a table write.
3. **`team-context.tsx`.** `TeamState` gains `createInvite: (temporary:
   boolean) => Promise<MutationResult & { inviteId?: string }>`,
   `revokeInvite: (inviteId: string) => Promise<MutationResult>`, and
   `canRevokeInvite: (invite: TeamInvite) => boolean` (a per-row predicate,
   so it is a function where the other `can*` members are booleans — say so
   in its comment). Implement in the `requireContext` → permit → db → reload
   idiom: `createInvite` refuses `manager-only-invite` when `!permitInvite`,
   then `inviteCreationBlocker(ctx.team, Date.now(), temporary)` → that code
   (the `{max}` value for the cap), then `db.createInviteCode`, then `await
   reload()`. `revokeInvite` finds the invite in `ctx.team.invites`
   (`team-not-found` if absent — the list is already stale, reload covers it),
   refuses `creator-or-mod-only-revoke-invite` when `!canRevokeInvite`, then
   `db.revokeInviteCode`, then `await reload()`. Add both to the `value` memo
   and its dependency list. Change `joinTeamByCode`'s local lookup at `:2592`
   to `t.invites.some(i => i.code.toLowerCase() === …)`.
4. **Both catalogs, `errors` namespace only** (the modal's own keys are Phase
   4): `manager-only-invite` — "Only the leader or moderators can make invite
   links in this team." / "Só o líder ou os moderadores podem criar links de
   convite neste time."; `creator-or-mod-only-revoke-invite` — "Only the
   leader, a moderator, or whoever made a link can revoke it." / "Só o líder,
   um moderador ou quem criou o link pode revogar."; `invite-permanent-exists`
   — "This team already has a permanent link — revoke it to make a new one."
   / "Este time já tem um link permanente — revogue ele pra criar outro.";
   `invite-temp-cap` — "This team already has {max} live 24-hour links. Revoke
   one or wait for one to expire." / "Este time já tem {max} links de 24 horas
   ativos. Revogue um ou espere um expirar." The exhaustive `Record` in
   `i18n/messages.ts` is what makes forgetting one a typecheck failure.

**Exit criteria:** `pnpm typecheck && pnpm lint` green across the monorepo with
the **old** invite modal still compiling against `team.invites` (it reads
`team.inviteCode` today — Phase 4 replaces the file, but if Phase 3 lands alone
it must swap that one read for `permanentInvite(team, Date.now())?.code ?? ""`).

### Phase 4 — The invite modal, and every sentence that mentions expiry

**Goal:** `invite-modal.tsx` becomes a link manager; nothing else on screen
changes shape. Every string goes through `messages/*.json`, both locales, in
the §7 voice (dry, plain, no exclamation marks, "you" not "the user").

**Tasks:**

1. **Structure**, top to bottom inside `ModalShell` (eyebrow `INVITE FRIENDS`,
   title the team name — unchanged):
   - The existing preview card (SMark, "Join {team} on SL", members/open bets)
     — unchanged.
   - **Live links** — eyebrow `inviteModal.activeLinks`; `liveInvites(team,
     now)` where `now = useNow()`; while `now` is `null` (first render) render
     every non-revoked invite with a `—` countdown, exactly as `bet-row.tsx`
     handles its first frame. Each row: a small uppercase kind label
     (`kindPermanent` = "PERMANENT" / `kindTemporary` = "24H" — §3 confines
     uppercase to short status labels, this is one); for a temporary link the
     countdown `expiresIn` "expires in {time}" with `time =
     formatTimeLeft(locale, invite.expiresAt, now).label` (reuses the app's
     `4h 12m` shape, D7 of the i18n plan); the URL
     `${origin}/join/${invite.code}` in the same read-only mono input as today;
     an outline **Copy** button with per-row `copied` state (the existing
     2-second flip); and, when `canRevokeInvite(invite)`, a destructive
     ordinary trigger (§5.3: neutral surface, ember icon only — lucide
     `Link2Off`, exists in 1.40.0; `aria-label={t("revoke", { code:
     invite.code })}` = "Revoke {code}", parameterised like `MemberRow`'s
     "Kick {name}" so a screen reader can tell eleven rows apart) that opens
     an **inline confirm row** under the link, copied from `MemberRow`'s
     kick/ban block (`team-settings-modal.tsx:222-255`): the sentence
     `revokeConfirm` ("Revoke this link? Anyone holding it can't use it to
     join any more."), a `cut-danger` **Confirm** (`confirmRevoke`, "Revoke
     link") and the same **Cancel** that block uses — outline, `border
     border-border text-muted-foreground` (not the borderless ghost variant;
     copy the classes, do not restyle). On success: `show({ kind:
     "destructive", text: t("revoked") })` ("Link revoked."), the row
     disappears with the reload. On failure: `errorText(result)` under the
     row.
   - **Empty state** when there are no live links: one dry sentence
     `noLinks` ("No live links. Make one below."), `text-xs
     text-muted-foreground`. **Deliberately not `<EmptyState>`** — that
     component (§5.10) is a whole-surface pattern with a 128px watermark and
     `py-16`, and a sub-section of a `sm:max-w-lg` modal is not a surface.
     Recorded here as the deviation it is.
   - **New link** — eyebrow `newLink`; shown when `canInvite` (always true for
     anyone who can open the modal, but check it anyway). A two-option choice
     built **exactly like the access-mode choice in
     `create-team-modal.tsx:84-115`** — two plain `<button type="button">`s,
     each independently focusable, selected state `border-jade bg-jade-wash`,
     plus `aria-pressed` for the state (that precedent has no ARIA state; add
     this one attribute, nothing more). **No `role="radiogroup"`** — the app
     has no radiogroup anywhere and a conformant one needs roving arrow-key
     focus this modal does not need. Options: `optionPermanent`
     ("Permanent") and `optionTemporary` ("{hours} hours", value from
     `CONFIG.INVITE_TEMPORARY_TTL_HOURS`). Under it one hint line for the
     selected option: `permanentHint` ("Works until someone revokes it.") /
     `temporaryHint` ("Dies on its own after {hours} hours."). Default
     selection: "24 hours" if a live permanent exists, otherwise "Permanent".
     The blocked option is `disabled` (§5.3: `opacity-40 pointer-events-none`)
     and the hint line then shows the reason instead — **read from the
     `errors` namespace via `useErrorText().codeText("invite-permanent-exists")`
     or `codeText("invite-temp-cap", { max })`**, so each sentence exists in
     exactly one place (D8 of the i18n plan); there are no
     `inviteModal.permanentExists`/`tempCapReached` keys. The **Create link**
     button (`create` / pending `creating`) is
     the modal's single jade primary (`cut-sm`, black text — §5.3; Copy and
     Confirm are outline and ember, so the budget holds). It calls
     `createInvite(selected === "temporary")`; on success the new row appears
     via reload, no toast (the row's Copy button is the next action and is the
     feedback); on failure `errorText(result)` under the button.
   - **Footer** replaces `revokeFuture`: `footerNote` ("Permanent links work
     until someone revokes them. 24-hour links expire on their own.").
   - `linkLabel` becomes the `aria-label` of each URL input; `neverExpires`
     and `revokeFuture` are **deleted from both catalogs** (the exhaustive
     `Messages` type will name any consumer left behind). Final `inviteModal`
     key set: `eyebrow, join, stats, linkLabel, copy, copied, activeLinks,
     noLinks, kindPermanent, kindTemporary, expiresIn, revoke, revokeConfirm,
     confirmRevoke, cancel, revoked, newLink, optionPermanent,
     optionTemporary, permanentHint, temporaryHint, create, creating,
     footerNote` — nothing else.
2. **Copy elsewhere, both catalogs:** `joinPage.noTeam` → "No team matches
   this invite code — it may have expired or been revoked. Ask whoever sent it
   for a fresh link." / pt-BR in the same register; `metadata.inviteNotFoundDescription`
   → "This invite code doesn't match any team — it may have expired or been
   revoked."; `leaveTeamModal.historyKept` → "Resolved bets keep their
   history. You can rejoin with a live invite link." No other key changes.
3. **pt-BR** follows §7.1: informal `você`, "link" stays "link", "24 horas"
   spelled out, "revogar" for revoke, "permanente" for permanent, no
   anglicisms where a Portuguese word is in daily use.
4. **Header comment** of `invite-modal.tsx` rewritten: what the modal is now,
   D5/D7/D8/D10 in one sentence each, and the `window.location.origin` note
   kept verbatim.

**Exit criteria:** `pnpm typecheck && pnpm lint && pnpm test` green;
`grep -rni "neverExpires\|revokeFuture\|inviteCode\b" apps/web/src packages/shared/src`
(case-insensitive, or the capitalised function names never match) returns
only `generateInviteCode`/`validateInviteCode` references.

### Phase 5 — Verify on dev, end to end

**Goal:** prove the schema, the grants, the RPCs, and the screen — on the dev
project only, with a real browser, before anything is committed.

**Tasks:**

1. `pnpm typecheck && pnpm lint && pnpm test` — green, output kept.
2. **Apply the migration to dev:** `supabase db push --linked --yes` (the
   `--yes` answers the CLI's own prompt; `pnpm db:push:dev` is the same
   command without it), then `pnpm db:status` shows `20260907150000` applied.
   This proves the forward migration applies on top of an existing schema —
   which is what prod will experience. Then `supabase db reset --linked --yes`
   **is allowed on dev** and is the simplest way to get the Phase 1 task 11
   demo rows in place — it wipes dev, re-applies every migration from zero and
   re-seeds the ten `@sl.local` fixtures (password `slfakebets`), which also
   proves the seed still loads. Never any of this against prod. If the
   migration itself has a defect at this point, fix the **uncommitted** file
   and `db reset --linked --yes` again — a follow-up migration is only for a
   file prod has already applied, and prod has not seen this one.
3. **Privilege audit** against dev: POST the whole of
   `scripts/supabase-privilege-audit.sql` as `{"query": …}` to
   `https://api.supabase.com/v1/projects/$SUPABASE_DEV_PROJECT_REF/database/query`
   with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (no `psql`/`jq` on this
   Mac; parse with python3). **Zero rows = pass.** A row for `invite_codes` or
   either new function means Phase 1 task 8/9/10 disagree — fix the migration
   (a *new* forward migration if dev already has it applied; never edit an
   applied file) and the audit together.
4. **RPC-level checks through PostgREST**, as a fixture: get a session with
   `POST https://qkwvmdshqnkfqekilipo.supabase.co/auth/v1/token?grant_type=password`
   (`apikey` = dev's anon key from `apps/web/.env.local`) for `rafa@sl.local`
   (team 1's leader), and one for `nina@sl.local` (an ordinary member). Then,
   with `Authorization: Bearer <jwt>` on `/rest/v1/rpc/…`:
   - `team_preview_by_code` for `originals-day-pass` → team 1;
     `originals-stale-pass` → empty; `originals-old-link` → empty.
   - Rafa `create_invite_code(team1, <fresh xxxx-xxxx>, true)` → uuid; preview
     it → team 1. Rafa `… false` → `SLI01` (a permanent exists).
   - Nina `create_invite_code(team1, …, true)` → uuid (free-for-all). Nina
     `revoke_invite_code(<Rafa's temporary>)` → `insufficient_privilege`. Nina
     revoking **her own** → success; preview it → empty. Rafa revoking Nina's
     (already revoked) → success (idempotent).
   - Cap: mint temporaries as Rafa until `SLI02` appears at the eleventh live
     one (the seed's live demo row counts). Revoke them afterwards.
   - Via the SQL runner as `postgres`: `update public.invite_codes set
     expires_at = now() - interval '1 minute' where code = <one live
     temporary>`; then `join_team_with_code` for it as a user who is **not**
     in team 1 (`guiz@sl.local` is in team 1; find a fixture who is not, or
     create one with `SUPABASE_DEV_SECRET_KEY` + `auth.admin.createUser`) →
     `no_data_found`.
   - Direct writes: `POST /rest/v1/invite_codes` (insert), `PATCH …?id=eq.<id>`
     (update), `DELETE …?id=eq.<id>` as Rafa → each **42501** / no rows
     affected. `GET /rest/v1/invite_codes` as Rafa → his teams' rows only.
5. **Browser verification** — the CDP recipe (headless Chrome at
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with
   `--headless=new --remote-debugging-port=0`, Node 22's global `WebSocket`, a
   named `--user-data-dir`, delete `SingletonLock`/`SingletonCookie`/
   `SingletonSocket` first; React inputs need the native value setter plus a
   bubbling `input` event; open a fresh page target per navigation). Check
   `lsof -nP -iTCP:3000 -sTCP:LISTEN` before `pnpm --filter web dev`; kill any
   leftover server first. Sign in as `rafa@sl.local` / `slfakebets`. Then:
   open **Invite** from the top bar; the list shows the permanent link and the
   seed's live 24-hour link with a countdown around `19h`; "Permanent" is
   disabled with its reason and "24 hours" is selected; **Create link** → a
   new `24H` row appears; **Copy** flips to "Copied"; the revoke icon opens the
   inline confirm; **Revoke link** → destructive toast, row gone; revoke the
   permanent link → "Permanent" becomes selectable → create one → it appears
   first in the list. Switch the profile-menu language to Português and repeat
   the read (no raw keys, no clipped labels in the `sm:max-w-lg` panel).
   Open `/join/originals-stale-pass` logged out → the not-found sentence and
   the OG description from task 2 of Phase 4 in the page `<head>`. Screenshots
   to the session scratchpad. **Stop the dev server** before handing back.
6. Any defect found here is fixed in place and the relevant check re-run; the
   plan records what was found in §8.

**Exit criteria:** every bullet in task 4 and 5 observed, not inferred; the
audit prints zero rows; typecheck/lint/test green after the last fix.

### Phase 6 — Docs and spec sync

1. **`AGENT_SPEC.md`**: §1 registry row for this file; §4.1 **UX-005** and
   §4.2 **DOM-005** amended per D12 (strikethrough the old clause, add the new
   one with the date and this file's name; the ID is never renumbered); §6
   item 6 → `~~…~~ **Resolved 2026-09-07** — plan-invite-links.md D5/D8`.
2. **`plan-mvp-roadmap.md` §8**: before the trailing "Hosting:" line, a short
   "Invite links: expiry choice & revocation — planned elsewhere" block in
   the shape of the pt-BR one: what it lifts (nothing from §6 risk 7), and the
   two things a reader of that doc needs (`Team.inviteCode` → `Team.invites`;
   `invite_codes` is no longer a direct client write).
3. **`design-dashboard.md`** §1.1 item 2: "→ invite modal (UX-023 preview;
   since plan-invite-links.md also the link manager — live links with kind and
   countdown, per-link revoke, permanent/24-hour composer)".
4. **This file's §8** gets the execution record: dates, what Phase 5 observed,
   any deviation from the tasks above and why.

### Phase 7 — Ship (owner steps, in this order)

1. `pnpm db:push:prod` — read the dry-run, confirm it lists exactly
   `20260907150000_invite_links.sql`, type `prod`.
2. Run the privilege audit once against prod (read-only) — zero rows.
3. `git push` — Vercel builds `main` as production.
4. On the production app: open Invite, create a 24-hour link, revoke it. Send
   yourself the permanent link on the phone; it still works.

---

## 5. Verification checklist (the whole plan, in one list)

- [ ] Migration applies to dev; `pnpm db:status` lists it
- [ ] Privilege audit on dev: zero rows
- [ ] `team_preview_by_code`/`join_team_with_code` refuse an expired and a revoked code, accept a live temporary and the permanent
- [ ] `create_invite_code`: `SLI01` on second permanent; `SLI02` at the cap; `insufficient_privilege` for a member of a `restricted` team who is not a mod
- [ ] `revoke_invite_code`: creator ok, mod ok, other member refused, idempotent on a revoked row
- [ ] Direct INSERT/UPDATE/DELETE on `invite_codes` over PostgREST refused
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green; `invites.test.ts` present
- [ ] Modal: list, countdown, copy, inline-confirm revoke with destructive toast, composer default/disabled logic, single jade primary — both locales
- [ ] `/join/<expired>` shows the new not-found sentence; OG description updated
- [ ] `AGENT_SPEC.md` UX-005/DOM-005 amended, §6 #6 resolved, registry row added
- [ ] Committed on `main`; **not pushed**; owner has the two Phase 7 commands

---

## 6. Risks

1. **Deploying code before schema.** The modal breaks on open for every
   production user until the migration lands. Mitigated by D11's order and by
   the old code being schema-forward-compatible (it reads columns and calls
   functions that still exist) — the reverse order is the only unsafe one.
2. **`create or replace` on the two read RPCs dropping a grant.** It does not
   when signature and return type are unchanged, but the audit in Phase 5 task
   3 is the proof, not this sentence. A red audit row means adding the grant
   in a follow-up migration, not editing the applied one.
3. **The client's clock vs the server's.** A skewed device shows a link as live
   for a minute after the server stopped honouring it, or vice versa. The RPCs
   are authoritative; the worst case is a "no team matches" on a link the
   modal still listed. Same trade every countdown already makes (D3).
4. **`useNow` ticks every 30 s.** A countdown that reads `0m 12s` is fine; a
   row that should vanish lingers up to 30 s. Acceptable; do not add a
   per-second interval to a modal for this.
5. **The `Messages` type will flag every deleted key's consumer.** That is the
   design working — fix consumers, never re-add a dead key to silence it.
6. **Seed rows with `now()`-relative dates** differ from `mock-data.ts`'s fixed
   ones. Deliberate (Phase 1 task 11); tests inject `now` and never read the
   seed.

---

## 7. Deferred, on purpose

- Other durations (1 hour, 7 days, single-use). One option was ordered; the
  column shape (D1) admits any of them later with no migration — only the RPC
  parameter and the composer change.
- Usage counts per link ("joined via this link: 4"). Would need a
  `joined_via` column on `team_members`; nobody asked.
- Realtime on `invite_codes` (D10).
- Leadership transfer, still the one unresolved neighbour in `leaveTeamModal`.
- A scheduled purge of expired/revoked rows. Rows are tiny and audit-useful;
  revisit only if the table ever matters to the free-tier ceiling.

---

## 8. Provenance and execution record

- **2026-09-07** — planned. Owner order in chat; codebase audited at commit
  `c46ccdc` (see §2). Read: every file in §1. Reviewed by four independent
  Sonnet passes (schema/RLS, TypeScript blast radius, UX/design/i18n,
  ops/verification) before execution; their findings were folded into the
  text above.
- Execution entries are appended below by the agents that run Phases 1–6.
- **2026-09-07/08 — Phase 1 (schema and RPCs) executed.** Wrote
  `supabase/migrations/20260907150000_invite_links.sql`: `invite_codes.expires_at`
  (nullable, D1), the `invite_codes_expiry_after_creation` check, the replaced
  one-live-permanent-per-team unique index plus `invite_codes_team_live_idx`,
  the two `app` tunables (`invite_temporary_ttl`,
  `invite_max_live_temporary_per_team`), `create or replace` of
  `team_preview_by_code`/`join_team_with_code` with the lazy-expiry predicate
  added (bodies copied verbatim from `20260905140000_team_rpcs.sql`), the two
  new `SECURITY DEFINER` RPCs `create_invite_code`/`revoke_invite_code` with
  `SLI01`/`SLI02`, the `anon`+`authenticated` grant/revoke shape (D4), and the
  withdrawal of the three `invite_codes` write policies plus the
  belt-and-braces revoke (verbatim `duel_schema.sql:360`'s shape). Updated
  `scripts/supabase-privilege-audit.sql` (the `inv` migration key, six
  `table_exceptions` rows, four `roster_functions` rows, two
  `function_exceptions` rows) and `supabase/seed.sql` (three demo
  `invite_codes` rows for team 1, `now()`-relative per task 11) and one
  `supabase/README.md` migrations-table row. Deviation: the four new
  `roster_functions` rows were placed at their alphabetically-correct
  positions in the existing roster (matching the file's own stated
  convention) rather than the plan's literal listed order — functionally
  identical, since the CTE is an unordered `VALUES` list. The migration was
  left **unapplied** at the end of this phase, as instructed; Phase 5 applied
  it.
- **2026-09-07/08 — Phase 2 (`packages/shared`) executed.** Added
  `TeamInvite` and `Team.invites: TeamInvite[]` (D7, replacing the
  `inviteCode` scalar), the two `CONFIG` tunables with the
  `DUEL_ACCEPT_WINDOW_HOURS`-shaped HARD WARNING, `invites.ts`
  (`isInviteLive`, `liveInvites`, `permanentInvite`, `liveTemporaryInvites`,
  `inviteCreationBlocker`), `permissions.ts`'s `canRevokeInvite` (D5), four
  new `MutationErrorCode` strings (`errors.ts`), updated `mock-data.ts`/
  `duel.test.ts` fixtures, reworded the `id.ts`/`validation.ts` UX-005
  comments to cite D1/D3, and `invites.test.ts` (16 tests). `@repo/shared`'s
  own typecheck/test were green throughout; the expected `apps/web`
  typecheck red (4 errors, exactly the files Phase 3/4 own) was confirmed
  and left for those phases. **Discovered, and since fixed**: turbo's local
  cache served a stale success for `web:typecheck`/`web:lint` after a
  `packages/shared/src` edit, because neither task declared a dependency on
  `@repo/shared`'s build — a plain `pnpm typecheck` at the repo root could
  report green against code that did not actually compile. `turbo.json` now
  declares `"typecheck": { "dependsOn": ["^typecheck"] }` and `"lint": {
  "dependsOn": ["^typecheck"] }` (the file's own comment dates the fix
  2026-09-08); the Phase 6 session re-verified it holds by forcing an
  uncached `npx turbo run typecheck lint test --force` — green, 4/4 tasks,
  856/856 tests.
- **2026-09-07/08 — Phase 3 (`apps/web/src/lib`) executed.** `team-data.ts`
  groups `invite_codes` rows into `Team.invites` via `toInvite`/
  `compareInvites` (permanent first, then `expiresAt`, then `createdAt`);
  `team-mutations.ts` extracted `withFreshCode` from `createTeam`'s retry
  loop and added `createInviteCode`/`revokeInviteCode`/`asInviteFailure`
  (SQLSTATE-keyed, D9's "never the message text"); `team-context.tsx` gained
  `canRevokeInvite`/`createInvite`/`revokeInvite` in the `requireContext` →
  permit → db → reload idiom, and `joinTeamByCode`'s lookup now scans
  `t.invites`; both message catalogs gained the four `errors.*` keys.
  `invite-modal.tsx` got the one mandated interim swap
  (`permanentInvite(team, Date.now())?.code ?? ""`) plus a scoped
  `eslint-disable-next-line react-hooks/purity` (the file's full rewrite in
  Phase 4 removes it). Root typecheck/lint/test green with the old modal
  compiling against the new `Team` shape.
- **2026-09-07/08 — Phase 4 (invite modal + copy) executed.** Rewrote
  `invite-modal.tsx` as the link manager described in §4: live-links list
  with kind/countdown/copy/per-row inline-confirm revoke, and a
  permanent/24-hour composer whose default and disabled logic is driven by
  `inviteCreationBlocker`. Both message catalogs' `inviteModal` namespace
  replaced with the plan's exact 24-key set (`neverExpires`/`revokeFuture`
  deleted); `joinPage.noTeam`, `metadata.inviteNotFoundDescription`, and
  `leaveTeamModal.historyKept` reworded per task 2. The exit-criteria grep
  came back clean: no `neverExpires`/`revokeFuture` anywhere; every
  surviving `inviteCode\b` hit is a function name
  (`generateInviteCode`/`validateInviteCode`/`createInviteCode`/
  `revokeInviteCode`) or one historical doc comment in `team-data.ts`, none
  in this phase's files.
- **2026-09-07/08 — Phase 5 (verify on dev) executed; re-confirmed
  2026-09-08.** Migration applied cleanly to dev (`qkwvmdshqnkfqekilipo`)
  with `supabase db push --linked --yes`; `pnpm db:status` showed
  `20260907150000` local==remote (re-confirmed again in this Phase 6
  session: `supabase migration list --linked` still lists `20260907150000`
  local==remote, unchanged). **Privilege audit: zero rows**, both when
  Phase 5 ran it and again when the Phase 6 session re-POSTed the full
  `scripts/supabase-privilege-audit.sql` to the Management API — the
  response was `[]`, i.e. 0 rows. **RPC-level checks** (task 4) were all
  directly observed: `SLI01` fired on a second permanent link for a team
  that already had a live one; `SLI02` fired exactly at the 10th
  live-temporary (message: "This team already has 10 live 24-hour
  links..."); `insufficient_privilege`/`42501` refused a restricted team's
  ordinary member from creating a link while correctly allowing a
  free-for-all ordinary member and the team's actual leader; the four
  `revoke_invite_code` cases were each exercised distinctly — creator-ok
  (204), mod-ok (204, a genuine moderator who neither created nor leads),
  other-member-refused (403/`42501`), and idempotent (204 on an
  already-revoked row); direct `POST`/`PATCH`/`DELETE` on
  `/rest/v1/invite_codes` all refused with `42501 permission denied for
  table invite_codes`; `GET` returned only the caller's own teams' rows —
  no leak. One pre-existing, unmodified behavior was noted as informational,
  not a regression: `join_team_with_code`'s `no_data_found` branch (SQLSTATE
  `P0002`) surfaces as HTTP 500 from PostgREST rather than 400, because
  PostgREST has no status mapping for `P0002` — verbatim from
  `20260905140000_team_rpcs.sql`, unchanged by this plan; the join was still
  correctly refused. **Browser verification** (task 5) walked every
  checklist row in §5 via headless Chrome over raw CDP, signed in as
  `rafa@sl.local`: the modal listed the permanent link and the seed's live
  24-hour link with a countdown around 19h46m; the composer defaulted to
  "24 hours" with "Permanent" disabled and the correct reason text; Create,
  Copy (flips to "Copied" and back after ~2s), and the inline-confirm Revoke
  flow (destructive toast reading exactly "Link revoked.") all worked as
  designed; revoking the permanent link made "Permanent" selectable again
  and a newly created one appeared first in the list; both locales were
  re-verified with no raw i18n keys and nothing clipped in the `sm:max-w-lg`
  panel (pt-BR driven via real keyboard nav on the Radix language submenu,
  since synthetic mouse events did not reliably fire its handlers — a
  testing-technique deviation, not a product change). Screenshots were
  written to that stage's own session-scratchpad directory; that directory
  is session-isolated and its own report recorded no explicit filenames, so
  no path is quotable from this Phase 6 session. One **genuine,
  pre-existing UI defect** was found and is **not fixed by this plan**:
  `apps/web/src/app/join/[code]/page.tsx`'s `generateMetadata`, in its
  not-found branch, never sets `openGraph`, so `<meta
  property="og:description">` on `/join/<expired-or-revoked-code>` falls
  back to the root layout's generic tagline instead of
  `metadata.inviteNotFoundDescription` (confirmed via an empty `git diff` on
  that file — it predates this plan entirely and sits outside every phase's
  authorized edit scope). Dev's `invite_codes` was left at the seed baseline
  both times a stage's own testing disturbed it, via `supabase db reset
  --linked --yes` (dev-only, explicitly permitted).
- **2026-09-08 — Phase 6 task 4 (this entry) executed.** No review findings
  were supplied to this pass (an empty list) — nothing to apply, and
  nothing to refute. Re-ran `pnpm typecheck && pnpm lint && pnpm test`:
  `pnpm typecheck` and `pnpm test` pass directly; a bare `pnpm lint` still
  fails with `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "eslint" not
  found` — the same `rtk` shell-hook command-rewrite artifact every prior
  stage already documented, reconfirmed here (`rtk proxy pnpm lint` and
  `npx turbo run lint` both succeed, cache hit; `pnpm lint` run alone,
  outside the `&&` chain, fails identically, so the artifact is in the hook,
  not in chaining). A forced, uncached `npx turbo run typecheck lint test
  --force` is green: **4/4 tasks, 856/856 tests**. No SQL was changed in
  this pass, so re-applying to dev and re-running the audit was not
  obligatory — done anyway, for the record: POSTing
  `scripts/supabase-privilege-audit.sql` to the dev Management API returned
  `[]` (0 rows), and `supabase migration list --linked` confirms
  `20260907150000` is still `local==remote` on dev — the schema Phase 5
  verified is exactly the schema dev still runs. Phase 6 tasks 1-3 (the
  `AGENT_SPEC.md`/`plan-mvp-roadmap.md`/`design-dashboard.md` sync) were
  already complete on disk before this session started; this entry adds
  only the execution record itself (task 4). Two items were found and left
  unfixed as outside this task's scope, flagged for the owner: the
  `og:description` defect above (pre-existing, unrelated to this plan), and
  the `rtk` shell hook's mis-rewrite of a bare `pnpm lint` (an environment
  artifact on this machine, independently rediscovered by three different
  stages and by this session).

- **2026-09-08 — orchestrator pass, before the commit.** Two changes outside
  the agents' file scopes, made after reading every stage report:
  (1) `apps/web/src/app/join/[code]/page.tsx`'s not-found branch now sets
  `openGraph`/`twitter` like the found branch does, so a dead link unwrapped
  in a chat shows `metadata.inviteNotFoundDescription` instead of the site
  tagline — the pre-existing defect the browser pass caught, fixed because
  Phase 4 task 2 wrote that sentence for exactly this card and the bug made
  it unreachable. (2) `turbo.json`: `typecheck` and `lint` gained
  `"dependsOn": ["^typecheck"]` after two stages independently observed turbo
  replaying a stale `web#typecheck` success across `packages/shared/src`
  edits (dry run confirmed `web#typecheck` counted zero shared files);
  verified afterwards that `web#typecheck` depends on `@repo/shared#typecheck`.
  Final uncached gate on the whole tree: `npx turbo run typecheck lint test
  --force` — 4/4 tasks, 856/856 tests. Committed on `main`, not pushed.

**What remains for the owner — Phase 7, unchanged from §4, owner steps only:**
1. `pnpm db:push:prod` — read the dry-run, confirm it lists exactly
   `20260907150000_invite_links.sql`, type `prod`.
2. Run the privilege audit once against prod (read-only) — zero rows.
3. `git push` — Vercel builds `main` as production.
4. On the production app: open Invite, create a 24-hour link, revoke it;
   send yourself the permanent link on the phone; it still works.

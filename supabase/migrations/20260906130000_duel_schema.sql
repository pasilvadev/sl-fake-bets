-- =============================================================================
-- SL Fake Bets — 1v1 duel bets: the schema half (Extra Phase 2, tasks 1/2/15).
--
-- WHAT A DUEL IS, IN ONE SENTENCE, BECAUSE EVERY DECISION BELOW FOLLOWS FROM IT
--
--   A duel is an ORDINARY `bets` row with a `kind` discriminator plus a 1:1
--   side table — it is NOT a new bet state, NOT a fourth column set bolted onto
--   `bets`, and NOT a second lifecycle. That is owner decision D1, taken before
--   this phase was written, and the whole point of it is what the NEXT kind of
--   bet costs: one enum value plus one side table, never a migration that
--   widens `bets` with another six nullable columns that 99% of the rows ignore
--   (the shape `20260905120000_domain_schema.sql` already refused for
--   `Team.inviteCode`, for the same reason, in this schema's very first file).
--
--   The corollary is the sentence this file exists to make true:
--   `public.enforce_bet_state_transition` (20260905120300_domain_invariants.sql)
--   is NOT WIDENED, NOT TOUCHED, and stays byte-for-byte what Phase 3 wrote.
--   It is the only trigger in the schema deliberately built with no
--   service-context escape hatch — "open → closed → resolved, nothing else" is
--   absolute and binds the RPCs exactly as it binds a client. "Waiting to be
--   accepted" is therefore NOT a fourth `bet_state`; it is
--   `kind='duel' AND accepted_at IS NULL AND state='open'` (D2), a fact
--   readable from two columns in two tables, and every void path in
--   `20260906130100_duel_rpcs.sql` takes the two legal hops in one transaction
--   rather than asking that trigger for an exception it does not grant.
--
-- WHY A SIDE TABLE RATHER THAN COLUMNS ON `bets`
--
--   `public.bet_duels` is 1:1 with `public.bets` on the primary key, the same
--   relationship `bet_options` and `wagers` have to their bet except narrowed
--   to exactly one row. Six columns that mean nothing for a pool bet live
--   there, so `bets` stays the shape every existing query, index, policy and
--   CHECK already assumes. Contrast `chat_messages`
--   (20260906120000_team_chat.sql), which broke the `comments` precedent and
--   carries `team_id` directly because its read pattern is "this team, this
--   window, this page" on every render: `bet_duels` has the OPPOSITE read
--   pattern — it is always fetched alongside the bets it hangs off, once per
--   team load, so the hop through `bets.team_id` is paid once and denormalising
--   team_id here would buy nothing and cost a drift source.
--
-- WHAT IS DELIBERATELY ABSENT
--
--   * No `status` / `phase` column. The phase is DERIVED — `computeDuelPhase`
--     (packages/shared/src/state-machine.ts) reads `bet.state`,
--     `duel.acceptedAt` and the clock and returns
--     'pending' | 'expired' | 'accepted' | 'settled'. D8 half (a): an
--     unaccepted duel past its deadline reads as expired BEFORE anything has
--     persisted the void, exactly as `computeEffectiveState` already treats a
--     stored-'open' bet past `closes_at` as closed. A stored phase column would
--     be a second copy of a truth two other columns already carry, and it would
--     be the copy that goes stale while the tab is open.
--   * No escrow / held-balance column (D5). The challenger's stake is a real
--     `wagers` row against their own side, debited at creation through the same
--     lock-then-debit sequence `place_wager` uses; the challengee's is debited
--     on accept. Coins are simply GONE from the balance and come back on any
--     void through `app.settle_bet`, exactly as `reverseBet` already returns
--     stakes. A held-balance column would be a third money representation for
--     `delete_bet`'s reversal to disagree with.
--   * No moderation column of any kind (DOM-030), in the same words the
--     `comments` and `chat_messages` tables use: there is no flag, no hidden,
--     no deleted_at concept anywhere in this schema and this table does not
--     introduce one. A mediator declares a WINNER; they do not remove, hide or
--     edit anything anyone wrote.
--   * No vote table, no vote count, no threshold (DOM-020 stays excluded). One
--     named person, or the moderator pool, resolves a duel. A single named
--     mediator is the OPPOSITE of an N-person consensus threshold, and nothing
--     in this phase moves toward one.
-- =============================================================================

-- --- the discriminator ----------------------------------------------------------
-- D1. Two values today; a third is what a future kind costs, and it costs
-- exactly one `alter type ... add value` plus one side table, which is the
-- entire architectural argument for this enum existing at all rather than a
-- boolean `is_duel`. A boolean would have to become an enum the day a third
-- kind appears, and by then it is in indexes, policies and a client union.
create type public.bet_kind as enum ('pool', 'duel');

-- D3. A void gains a REASON, and it is an enum rather than free text because
-- the next feature that voids a bet for a new reason should have to add a
-- value here — a change a reviewer sees — rather than invent a string
-- convention nothing validates.
--
-- Read the five values as WHO/WHAT decided, not as five kinds of void. A void
-- is still one thing (DOM-019: full refund, zero realized P/L, the
-- `VOID · REFUNDED` treatment); the reason is a suffix on it, never a second
-- state and never a different settlement:
--   'mediator'           — a human resolver voided it deliberately.
--   'declined'           — the challengee said no (public.decline_duel).
--   'insufficient-funds' — the challengee COULDN'T afford it, which the owner
--                          requires the history row to say in those words: a
--                          different sentence from "wouldn't".
--   'expired'            — nobody answered inside the accept window; written by
--                          app.expire_stale_duels with no human in the loop.
--   'participant-left'   — kick/ban/leave took one of exactly two participants
--                          out of the team (task 11).
create type public.bet_void_reason as enum (
  'mediator',
  'declined',
  'insufficient-funds',
  'expired',
  'participant-left'
);

-- --- bets gains two columns, and neither disturbs an existing row ----------------
--
-- `kind` is NOT NULL with a default, so every bet that already exists becomes a
-- 'pool' bet with no backfill statement and no rewrite of any existing query:
-- `create_bet` does not name the column and keeps producing pool bets, and
-- every SELECT that ignores it keeps working. `void_reason` is nullable and
-- stays NULL for every pool bet ever written, past or future — which is the
-- other half of "no backfill" (D3 says so in as many words).
alter table public.bets
  add column kind public.bet_kind not null default 'pool',
  add column void_reason public.bet_void_reason;

-- ADDITIVE, and the word is load-bearing. `bets_resolution_shape` — the CHECK
-- that keeps types.ts's BetResolution union honest (no resolution data before
-- 'resolved', a winner always names an option, a void never does) — is left
-- EXACTLY as Phase 3 wrote it (D1 / task 1). This is a second, independent
-- CHECK beside it rather than a rewritten one, for two reasons:
--
--   1. Rewriting a CHECK means dropping it, and for the duration of that
--      transaction the union is unenforced. There is no reason to open that
--      window to add a rule that is orthogonal to it.
--   2. The two rules are genuinely separate sentences. `bets_resolution_shape`
--      says what a RESOLUTION looks like; this one says a REASON only exists
--      where there is a void to attach it to. A single merged CHECK would name
--      one constraint in the error for two unrelated mistakes.
--
-- Note what it deliberately does NOT say: `resolution_kind = 'void'` does not
-- require `void_reason is not null`. Every pool bet void has no reason (D3),
-- and so do the two already sitting in the seed — a NOT NULL half here would
-- have needed exactly the backfill this design exists to avoid.
alter table public.bets
  add constraint bets_void_reason_shape
  check (void_reason is null or resolution_kind = 'void');

comment on column public.bets.kind is
  'D1 discriminator. ''pool'' is every bet Phases 3-9 ever wrote (NOT NULL DEFAULT, so no backfill); ''duel'' rows carry a 1:1 public.bet_duels row with everything kind-specific. bets.state is untouched by this: a duel uses the same open→closed→resolved lifecycle, enforced by the same unwidened trigger.';

comment on column public.bets.void_reason is
  'D3. NULL for every pool bet and for any void that predates Extra Phase 2. A suffix on DOM-019''s void, never a second state: the money effect is a full refund through app.settle_bet regardless of which value is stored.';

-- --- bet_duels ------------------------------------------------------------------
--
-- Mirrors packages/shared/src/types.ts's `Duel` field-for-field, and `Duel` is
-- a SEPARATE interface hanging off `Bet` by id rather than six optional fields
-- on `Bet` — the TypeScript expression of the same D1 decision this table is.
--
-- `bet_id` is BOTH the primary key and the foreign key, which is what makes
-- "at most one duel row per bet" structural rather than declared. ON DELETE
-- CASCADE: the duel row has no life of its own, and `delete_bet` (DOM-033)
-- removing the bet must take it with it — there is no orphan state to design a
-- rule for.
create table public.bet_duels (
  bet_id uuid primary key references public.bets (id) on delete cascade,

  -- The two participants. RESTRICT on both, matching `bets.creator_id` and
  -- `teams.leader_id`: a profile row cannot vanish out from under money that
  -- is attributed to it. (Nothing in the app deletes a `public.users` row at
  -- all — profiles die only with their `auth.users` row, by cascade.)
  challenger_id uuid not null references public.users (id) on delete restrict,
  challengee_id uuid not null references public.users (id) on delete restrict,

  -- The named resolver (D7), or NULL to rely on the any-moderator pool.
  --
  -- ON DELETE RESTRICT, AND THIS IS THE ONE THING IN THIS FILE THAT WAS DECIDED
  -- AGAINST THE RUNNING DATABASE RATHER THAN FROM MEMORY. The phase's plan drafted
  -- this column as `on delete set null`, reasoning that D7 means a departing
  -- mediator strands nothing (true — see below) and therefore nulling the column
  -- is harmless. It is not harmless, and the reason is a Postgres fact worth
  -- writing down because it is easy to assume the other way:
  --
  --   A referential action is not a magic column edit. `ON DELETE SET NULL`
  --   executes a real `UPDATE ONLY <child> SET <col> = NULL`, and that UPDATE
  --   re-evaluates EVERY row-level CHECK on the child table. Verified on this
  --   stack (PostgreSQL 17.6), not assumed — a two-table probe with exactly
  --   this shape produced:
  --
  --     ERROR:  new row for relation "child" violates check constraint
  --             "child_has_a_resolver"
  --     DETAIL:  Failing row contains (10, null, f).
  --     CONTEXT: SQL statement "UPDATE ONLY "fkprobe"."child"
  --              SET "med" = NULL WHERE $1 OPERATOR(pg_catalog.=) "med""
  --
  --   So on a duel with `any_moderator = false`, a `set null` action would fire
  --   `bet_duels_has_a_resolver` below and abort — and it would abort the
  --   DELETE OF THE USER, several tables away, with a check-violation naming a
  --   constraint on a table nobody was touching. That is the worst possible
  --   shape for a failure: a `delete from auth.users` failing with
  --   "bet_duels_has_a_resolver".
  --
  -- RESTRICT instead makes the refusal honest and identical to the one the two
  -- participant columns already give: you cannot delete a profile that is
  -- named on a duel. Same rule, same message shape, one less special case.
  --
  -- None of this weakens D7. "A departing mediator strands nothing" is about
  -- LEAVING THE TEAM — a `team_members` row going away — which touches no
  -- foreign key here at all. `app.can_resolve_duel` re-derives the resolver set
  -- at READ time, so the moment a named mediator stops being a team member the
  -- duel is resolvable by the any-moderator pool with nothing stored,
  -- reassigned or migrated. The FK action is about a PROFILE being hard
  -- deleted, which is a different event that the app never performs.
  mediator_id uuid references public.users (id) on delete restrict,

  -- D7's additive half: ticking "any moderator" does not REPLACE the named
  -- mediator, it adds the moderator pool alongside them, so a duel is never
  -- frozen behind one quiet person. Whoever acts first resolves it.
  --
  -- Also D9's storage: in a `restricted` team `create_duel` writes `true` here
  -- regardless of what the challenger sent. NOT NULL with no default on
  -- purpose — every writer must state it, because "unspecified" is exactly the
  -- ambiguity D9's coercion exists to remove.
  any_moderator boolean not null,

  -- D5: symmetric, chosen by the challenger, paid by both sides. The `>= 1`
  -- floor is validateWager's / validateDuelDraft's, mirrored here for the same
  -- reason every other invariant is duplicated in SQL (see the invariants
  -- migration's header): a rule that lives only in validation.ts stops being an
  -- invariant the moment a write arrives from Studio or PostgREST.
  --
  -- This is stored even though it is derivable from the two wagers, and that is
  -- deliberate: `bets.max_wager_per_user` is set equal to it by `create_duel`
  -- (task 6), which is what makes a third wager structurally impossible, and a
  -- void that has already refunded both wagers still has to be able to say what
  -- the duel was FOR.
  stake integer not null check (stake >= 1),

  -- NULL until the challengee accepts. This single column is what
  -- `computeDuelPhase` and `canAcceptDuel`/`canDeleteDuel` read, and it is
  -- STORED FACT, never the clock — an unaccepted duel whose deadline has passed
  -- still has `accepted_at IS NULL` and must not be acceptable, which is why
  -- every surface checks the phase and not just this column.
  accepted_at timestamptz,

  -- The accept deadline, written equal to the bet's `closes_at` at creation.
  -- It is NOT redundant with it, and the reason is D2: on accept the bet does
  -- exactly what `close_bet_early` does — `state='closed'`, `closes_at=now()`
  -- — so after acceptance the BET no longer remembers when the challenge would
  -- have lapsed. The duel row still does, which is the only place that fact
  -- survives.
  expires_at timestamptz not null,

  -- The three rules a CHECK can actually state. Their TypeScript twin is
  -- `validateDuelDraft` (packages/shared/src/validation.ts), which produces the
  -- reader-facing sentence for each; these are what hold when the write does
  -- not come through the client.
  constraint bet_duels_distinct_participants check (challenger_id <> challengee_id),
  constraint bet_duels_mediator_not_participant check (
    mediator_id is null
    or (mediator_id <> challenger_id and mediator_id <> challengee_id)
  ),
  -- "A duel with no possible resolver is not a duel." Note this is a CHECK and
  -- NOT the place D9 is enforced: D9's coercion belongs to `create_duel` alone,
  -- because a CHECK re-evaluates against the team's CURRENT access mode on any
  -- later UPDATE and would retroactively invalidate a duel created under the
  -- other mode — precisely what D9's "enforced at creation, never
  -- retroactively" forbids. This constraint reads only columns of this row and
  -- therefore cannot change its mind about a row that has not changed.
  constraint bet_duels_has_a_resolver check (mediator_id is not null or any_moderator)
);

-- The pending lookup: "challenges waiting for an answer from this person",
-- which is D4's re-ordering (a duel awaiting YOUR acceptance sorts to the top
-- of its group FOR YOU) and nothing else — D4 is emphatic that this produces no
-- push, no email, no bell and no tab title (ARC-014). Partial, because a duel
-- is unaccepted for at most 24 hours and accepted forever after.
create index bet_duels_pending_challengee_idx
  on public.bet_duels (challengee_id) where accepted_at is null;

-- Task 9's anti-spam half that a BEFORE INSERT trigger cannot express, and the
-- distinction is concurrency, not expressiveness: a trigger answers "does a
-- pending duel between these two already exist?" with a SELECT, and two
-- simultaneous `create_duel` transactions can both get "no" before either has
-- inserted. This index is the half that actually holds under that race; the
-- trigger (and `create_duel`'s own pre-check) exist to turn the loser's bare
-- 23505 into a sentence a person can read.
--
-- RATE CONTROL, NOT MODERATION — the same paragraph `enforce_chat_flood_control`
-- carries, and it belongs here too. This index bounds how many challenges one
-- account may have IN FLIGHT toward one other account. It never looks at who
-- they are or what the title says. DOM-030 is untouched by it, and nobody
-- reading this later should mistake a cap on volume for a licence to build one
-- on content.
--
-- KNOWN OVER-REACH, WRITTEN DOWN RATHER THAN DISCOVERED LATER: the predicate is
-- `accepted_at is null`, which is what the phase's implementation contract
-- fixes it as, and that is BROADER than the rule the roadmap states ("a second
-- PENDING duel"). A duel that was declined, expired or cascaded still has
-- `accepted_at IS NULL` forever — it was never accepted — so after A challenges
-- B and B declines, A cannot challenge B again in that team. "Pending" needs
-- `bets.state <> 'resolved'`, and a partial index predicate cannot reach
-- another table, so closing the gap needs either a denormalised `voided_at`
-- column here (which `20260905120000_domain_schema.sql` argues against in as
-- many words — "a join is not a redesign, a duplicated column is a drift
-- source") or moving the pair rule wholly into the trigger and giving up the
-- concurrency guarantee. Neither is this file's call to make unilaterally, so
-- the index ships as specified and the limitation is stated here, in the one
-- place a reader will be standing when they hit it.
create unique index bet_duels_one_pending_per_pair_idx
  on public.bet_duels (challenger_id, challengee_id) where accepted_at is null;

comment on table public.bet_duels is
  'D1: the kind-specific half of a 1v1 duel, 1:1 with public.bets on the primary key. Every write is an RPC (20260906130100_duel_rpcs.sql) — there is no INSERT/UPDATE/DELETE policy for anyone, as bets has had none since Phase 6. Phase is DERIVED (computeDuelPhase), never stored. D7: a departing mediator strands nothing because app.can_resolve_duel falls back to the any-moderator pool at read time.';

comment on column public.bet_duels.mediator_id is
  'D7''s named resolver, or NULL for any-moderator-only. ON DELETE RESTRICT, not SET NULL: a SET NULL action runs a real UPDATE that re-evaluates bet_duels_has_a_resolver, so on an any_moderator=false duel it would abort the deletion of the users row with a check violation naming a table nobody touched (verified on PostgreSQL 17.6 — see this migration''s inline probe output).';

comment on column public.bet_duels.expires_at is
  'The accept deadline, equal to the bet''s closes_at at creation. Not redundant: on accept the bet takes close_bet_early''s move (state=closed, closes_at=now()) and stops remembering when the challenge would have lapsed. This column is where that fact survives.';

-- --- RLS ---------------------------------------------------------------------------
-- Modelled on the `bets` block in 20260905120400_rls_policies.sql AS IT STANDS
-- TODAY — i.e. after Phase 6's tightening, which withdrew every write policy on
-- `bets` in favour of the RPCs. `bet_duels` is born in that state rather than
-- passing through a permissive one: there is no phase of this table's life in
-- which a client could write it directly, so there is no policy to drop later.
alter table public.bet_duels enable row level security;

-- "Everyone can see the details" — the owner's words, and it is the whole
-- visibility rule. A duel is fully visible to the team from the moment it is
-- created, so there is no second, temporary visibility mode to build and no
-- "only the participants until accepted" state to get wrong. `app.is_bet_team_member`
-- is the same two-hop helper `bet_options`, `wagers` and `comments` already use
-- (bet_id → bets.team_id → team_members), so this table cannot drift from them.
create policy bet_duels_select_bet_team_member on public.bet_duels
  for select to authenticated
  using (app.is_bet_team_member(bet_id));

-- NO INSERT, UPDATE OR DELETE POLICY FOR ANYONE, and none is coming.
--
-- Every duel write is a multi-row, money-moving transaction that RLS
-- structurally cannot express — creation writes six rows across four tables and
-- debits a balance; acceptance writes a wager, a debit, a state transition and
-- a timestamp; a void runs two legal state hops and applies settlement deltas.
-- The same three reasons Phase 5 and Phase 6 gave for withdrawing direct writes
-- on `teams`, `team_members`, `bets`, `bet_options` and `wagers` apply here
-- from birth, so `bet_duels` simply never gets one.
--
-- In particular there is no UPDATE policy for the challengee to "accept" by
-- stamping `accepted_at` themselves: doing so without the wager, the debit and
-- the `state='closed'` transition in the same transaction produces an accepted
-- duel with one side's money in it, which is the halfway state
-- `20260905150000_bet_rpcs.sql`'s header calls out by name.
grant select on public.bet_duels to authenticated;

-- Belt and braces, in the shape and for the reason the chat migration's revoke
-- block states: RLS filters ROWS, but a verb that was never granted cannot be
-- reached even through a future policy mistake. This schema's inherited ALTER
-- DEFAULT PRIVILEGES hands INSERT/UPDATE/DELETE/TRUNCATE to `authenticated` at
-- CREATE TABLE time, so these revokes are a deliberate correction of an
-- inherited default rather than a no-op.
--
-- TRUNCATE matters more than it looks, exactly as it did for `chat_messages`:
-- it is the one statement that BYPASSES RLS entirely, so a
-- `truncate public.bet_duels` would strip every team's duels of their
-- kind-specific half at once, leaving orphan `bets` rows with `kind='duel'` and
-- no participants, no stake and no resolver — money in wagers with nothing left
-- to settle it against.
revoke insert, update, delete, truncate on public.bet_duels from authenticated, anon;

-- --- realtime --------------------------------------------------------------------
-- Deliberately NOT here. `alter publication supabase_realtime add table
-- public.bet_duels` lives in its own migration, `20260906130200_duel_realtime_
-- publication.sql`, for the ordering reason `20260906120000_team_chat.sql`
-- learned the hard way and wrote down: a publication statement is not a forward
-- declaration, so it must sort AFTER the `create table` that brings the
-- relation into existence. It could legally have gone at the bottom of THIS
-- file (the table exists by then), and the reason it did not is that the phase
-- keeps the publication change as its own reviewable unit — the same separation
-- `20260905190000_realtime_publication.sql` exists to provide.

-- --- feature flag: duel-bets (task 15, SQL half) -----------------------------------
-- ARC-016's kill switch for this whole feature, seeded TRUE because the feature
-- ships working — unlike the five placeholders `20260905120100_infra_tables.sql`
-- seeded FALSE, which were markers for things that did not exist yet.
--
-- INSERT ... ON CONFLICT DO UPDATE, and NOT the plain UPDATE the chat migration
-- used, because the two situations are genuinely different: `global-team-chat`
-- already existed as a Phase 3 placeholder row and only needed flipping, while
-- `duel-bets` has never existed. The `on conflict` arm is not defensive
-- padding — `supabase db reset` re-runs this file against a database where the
-- previous run's row is gone, but a HOSTED database (ARC-012, still unbuilt)
-- would re-apply it against a row that is present, and an operator who had
-- flipped the switch off in Studio deserves this migration to be a no-op
-- rather than a silent re-enable... which is exactly why `enabled` is NOT in
-- the DO UPDATE list. The description is, because the description is
-- documentation and should track this file; the switch position belongs to
-- whoever last flipped it.
insert into public.feature_flags (key, enabled, description)
values (
  'duel-bets',
  true,
  'Extra Phase 2/3: 1v1 duel bets (challenge a teammate, fixed symmetric stake, mediator-resolved). LIVE and seeded on — this is a kill switch, not a future-feature placeholder. Flipping it false hides the compose entry point, the duel row treatment and the resolve control on the next load (ARC-016, no deploy, no rebuild) and must NOT be read as a way to stop duels already in flight: app.expire_stale_duels, app.void_duel and public.resolve_bet keep working regardless, because a flag that could strand coins would not be a kill switch, it would be a leak.'
)
on conflict (key) do update
  set description = excluded.description;

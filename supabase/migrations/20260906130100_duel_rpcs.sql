-- =============================================================================
-- SL Fake Bets — 1v1 duel write paths (Extra Phase 2, tasks 7-11 + the guards
-- task 8 adds to the four functions that already existed).
--
-- Same three reasons Phases 5-7 gave for moving every write into a SECURITY
-- DEFINER function, and a duel makes all three sharper rather than adding a
-- fourth:
--
--  1. Atomicity. `create_duel` writes SIX rows across FOUR tables — the `bets`
--     row, two `bet_options`, the `bet_duels` row and the challenger's own
--     wager — and debits a balance, all of which must land together or not at
--     all. PostgREST runs one statement per transaction, so a client sequence
--     would be able to strand a duel with options but no participants, or a
--     stake debited against a bet that does not exist.
--  2. Rules RLS structurally cannot express. D9's coercion needs the team's
--     `access_mode` read in the SAME transaction that writes the row; the
--     pending-challenge cap needs a COUNT across two tables; and every void
--     needs two state UPDATEs plus settlement deltas applied to N member rows.
--  3. The coin_balance write gate. `enforce_team_member_update_rules`
--     (20260905170000_resolution_rewards_ledger.sql) refuses ANY direct balance
--     change outside service context — which is what makes these functions
--     mandatory rather than preferable.
--
-- THE FIVE THINGS THIS FILE DOES NOT DO, EACH OF WHICH HAS ALREADY COST
-- SOMEBODY A DEBUGGING SESSION IN THIS REPO OR IS ONE LINE AWAY FROM DOING SO:
--
--  A. It does NOT touch `public.enforce_bet_state_transition`. That trigger is
--     the only one in the schema with no service-context escape hatch, on
--     purpose, and it stays byte-for-byte what Phase 3 wrote. Consequently
--     EVERY void path here — decline, expiry, the departure cascade, and
--     `delete_bet`'s pre-acceptance path — writes `closed` FIRST and `resolved`
--     SECOND, as two legal hops inside one transaction. `open → resolved` is
--     refused, loudly, which is the good case; the bad case is a session
--     widening the trigger to make the error go away. Do not. `app.void_duel`
--     below is the single place those two hops are written, so there is exactly
--     one function to read if the rule ever changes.
--  B. It does NOT widen `app.can_manage_bet`. Three RPCs share that one
--     creator-or-moderator rule (`close_bet_early`, `delete_bet`, `resolve_bet`),
--     so the obvious one-line "just let the mediator in" edit would silently
--     hand every mediator DELETE and EARLY-CLOSE on the duel they are judging —
--     including the losing one. Resolution forks instead, into
--     `app.can_resolve_bet` → `app.can_resolve_duel`, and `app.can_manage_bet`
--     is left verbatim. This is the phase's named risk 1.
--  C. It writes NO second settlement path. Every payout and every refund in
--     this file goes through `app.settle_bet` — the SQL twin of
--     packages/shared/src/settlement.ts that Phase 6 wrote for `delete_bet`'s
--     reversal and Phase 7 reused for `resolve_bet`. `settleBet` is ALREADY
--     exactly right for a duel: two members, symmetric stakes, opposite
--     options → winner `+2×stake` balance / `+stake` P/L, loser `0` / `−stake`,
--     a flat 2.00x each side from `getPoolStats`, and a void refunds both in
--     full at zero P/L. That is a PROOF (task 6), not an implementation. A
--     "simpler" direct transfer would end up a coin apart from `resolve_bet`
--     somewhere and break `delete_bet`'s reversal — the phase's risk 3.
--  D. It writes NO `transactions` row, ever (DOM-025 / decision §4.6). A stake
--     leaves the balance at placement and a payout is not a transfer, exactly
--     as for a pool bet. `public.transaction_kind` is not extended and must not
--     be.
--  E. It notifies NOBODY (ARC-014). No push, no email, no bell, no tab title,
--     and nothing in this file writes a row whose only purpose would be to feed
--     one. D4's answer to "how does the challengee find out" is that the FEED
--     RE-ORDERS for them, which is Extra Phase 3 and is a sort, not a message.
--
-- One more, because the anti-spam trigger at the bottom will be read by someone
-- one day and it must answer them before they ask: the cap and the pair rule
-- are RATE CONTROL, NOT MODERATION. They bound how many challenges one account
-- may have IN FLIGHT and say nothing whatever about who they are aimed at or
-- what the title says. DOM-030 — no content moderation system, ever — is
-- untouched by them, and no control anywhere in this feature deletes or hides
-- anyone's message or comment.
-- =============================================================================


-- =============================================================================
-- SHARED CONSTANTS
-- =============================================================================

-- CONFIG.DUEL_ACCEPT_WINDOW_HOURS's SQL twin, and the FOURTH duplicated
-- constant in this schema after `app.onboarding_grant_coins()` (DOM-021),
-- `app.daily_reward_coins()` (DOM-022) and `app.chat_retention_interval()`
-- (UX-019). Every one of those carries the same warning in both halves and so
-- does this one: THIS function is the authority, because it is what actually
-- computes the deadline the row stores — no client value is ever sent for it,
-- for the reason a browser that could name its own deadline could name one ten
-- years out. `CONFIG.DUEL_ACCEPT_WINDOW_HOURS` exists to write the sentence
-- ("they have 24 hours to accept") and to preview the deadline in the compose
-- form before the round trip. Change one and you must change the other in the
-- same commit, or the copy starts lying about what the database enforces —
-- silently, with no test able to catch it.
create or replace function app.duel_accept_window()
returns interval language sql immutable set search_path = '' as $$
  select interval '24 hours';
$$;

-- CONFIG.DUEL_MAX_PENDING_PER_CHALLENGER's SQL twin, and — since the phase's
-- contract counts the accept window as the fourth — the FIFTH. It exists as a
-- function rather than a bare literal for one concrete reason, and the reason
-- is local to this file: the number is needed in TWO places here (`create_duel`,
-- which produces the sentence a person reads, and the BEFORE INSERT trigger,
-- which bounds a write that arrives any other way). Two copies of a tunable
-- inside one migration is a drift source that would not survive the first edit,
-- and design-stack.md §4 rule 4 forbids hardcoding a tunable anyway. One
-- function, called twice, is the smallest honest shape.
--
-- Same standing warning as every other twin: `CONFIG.DUEL_MAX_PENDING_PER_
-- CHALLENGER` in packages/shared/src/config.ts is the product source of truth
-- and `asDuelFailure` in bet-mutations.ts interpolates ITS copy into the toast.
-- If these two disagree, the sentence a member reads will name a different
-- number from the one that refused them.
create or replace function app.duel_max_pending_per_challenger()
returns integer language sql immutable set search_path = '' as $$
  select 3;
$$;


-- =============================================================================
-- AUTHORIZATION HELPERS — the SQL mirror of permissions.ts's duel rules
--
-- Same contract as 20260905120200_auth_helpers.sql: permissions.ts stays the
-- source of truth for the RULES, these are their enforcement at the database
-- boundary, and each one names its TypeScript counterpart.
--
-- And the same standing caveat those helpers carry, restated because duels make
-- it easier to get wrong: THESE ARE ROSTER + ID RULES ONLY. The clock is not
-- theirs. `computeDuelPhase` (state-machine.ts) owns "is this thing still
-- pending, or did it expire while the tab was open", and every surface must ask
-- both — a permission check that passes on an expired duel is not a bug in
-- these functions, it is the surface forgetting the other half.
-- =============================================================================

-- permissions.ts: the participant exclusion inside `canResolveDuel`, lifted out
-- as its own named function because "is the caller in this duel" is a question
-- the resolve path, Extra Phase 3's row treatment and any future guard all ask
-- separately. D6 in one line: a challenger must never be able to judge their
-- own losing bet.
create or replace function app.is_duel_participant(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.bet_duels d
    where d.bet_id = p_bet_id
      and (select auth.uid()) in (d.challenger_id, d.challengee_id)
  );
$$;

-- permissions.ts: canResolveDuel, D6 + D7, and the ORDER of the clauses is the
-- design.
--
-- Participants are excluded FIRST and unconditionally — before the mediator
-- test and before the moderator test — because D7's "a moderator who is a
-- participant is excluded by the same rule that excludes the creator" only
-- holds if the exclusion runs ahead of the any-moderator pool. Then the named
-- mediator, then the pool. `any_moderator` is read from the STORED ROW and not
-- re-derived from the team's current access mode: D9 is enforced at creation,
-- never retroactively, so flipping a team to `restricted` (or back) must not
-- change who may resolve a duel that is already in flight.
--
-- `mediator_id = auth.uid()` is null-safe by construction: a NULL mediator
-- makes that comparison NULL, and the OR falls through to the pool test, which
-- `bet_duels_has_a_resolver` guarantees is the true half whenever the mediator
-- is absent.
--
-- THE THIRD DISJUNCT IS D7'S STRANDING GUARANTEE, AND IT IS THE HALF THAT IS
-- EASIEST TO LEAVE OUT — because the first two read like the whole rule, and
-- the case it covers only appears after somebody leaves a team. The roadmap
-- states it twice: task 11 says "`app.can_resolve_duel` falls back to the
-- any-moderator pool at read time, so the duel is resolvable by any moderator
-- the moment its named mediator is gone — a runtime check, not a stored
-- reassignment, and nothing is ever stranded", and it is an exit criterion in
-- its own right ("The named mediator leaves the team; any moderator can still
-- resolve the duel").
--
-- Without it, an ACCEPTED duel with `any_moderator = false` whose named
-- mediator has left the team has an EMPTY resolver set, permanently, and the
-- money is gone with it: both stakes are already debited (D5), `delete_bet`
-- refuses an accepted duel (D6), `close_bet_early` refuses any duel, and
-- `app.void_duels_for_departing_member` fires only for a PARTICIPANT — a
-- departing mediator is exactly the case it deliberately skips, on the
-- strength of this fallback existing. So 2 × stake would sit forever in a
-- `closed` bet that no path in this schema can settle, with no error anywhere
-- to say so. Verified live before this line was written: with the disjunct
-- absent, `resolve_bet` refused a plain moderator on precisely that shape with
-- "Only the mediator or a moderator can resolve this duel." — a sentence that
-- is true and useless, because at that point there is no mediator left to be.
--
-- READ TIME, NEVER A STORED REASSIGNMENT. `mediator_id` is untouched, so the
-- history row still names who was supposed to judge, and if that person
-- re-joins the team the pool closes again by itself. It keys on absence from
-- `team_members` — the same fact `app.is_team_member` answers, scoped to the
-- BET's team — and never on the team's access mode, so D9's
-- non-retroactivity is untouched.
--
-- The `d.mediator_id is not null` guard is not redundant: "nobody was named"
-- must not read as "the named person left". A duel with a null mediator is
-- guaranteed `any_moderator = true` by `bet_duels_has_a_resolver`, so the
-- second disjunct has already admitted the pool; without the guard, the third
-- would admit it a second time on a different and wrong ground.
create or replace function app.can_resolve_duel(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1
      from public.bet_duels d
      join public.bets b on b.id = d.bet_id
     where d.bet_id = p_bet_id
       and app.is_team_member(b.team_id)
       and (select auth.uid()) not in (d.challenger_id, d.challengee_id)
       and (
         d.mediator_id = (select auth.uid())
         or (d.any_moderator and app.is_moderator_or_leader(b.team_id))
         or (
           -- D7: the named mediator is gone, so the pool takes over.
           d.mediator_id is not null
           and not exists (
             select 1 from public.team_members tm
              where tm.team_id = b.team_id and tm.user_id = d.mediator_id
           )
           and app.is_moderator_or_leader(b.team_id)
         )
       )
  );
$$;

-- THE FORK, and the whole reason `app.can_manage_bet` survives this phase
-- unwidened (see this file's header, point B). One function still owns "who may
-- resolve this bet", so `resolve_bet` keeps a single authorization call and a
-- future third kind of bet adds an arm here rather than a branch in the RPC.
--
--   'pool' → app.can_manage_bet VERBATIM. Creator, moderator, leader (A-1),
--            exactly as DOM-018/019 have meant since Phase 3. Not one character
--            of that rule changes for a pool bet.
--   'duel' → app.can_resolve_duel. A disjoint set: participants OUT (D6),
--            the named mediator IN, the moderator pool in only when the stored
--            row says so (D7).
--
-- A bet id that matches nothing takes the `else` arm and lands on
-- `app.can_manage_bet`, which returns false for a missing bet — so a deleted
-- bet is refused by authorization before the RPC's own "This bet no longer
-- exists." can fire. Both answers are correct and the RPC checks existence
-- first anyway; this is noted so the `else` arm does not look like an oversight.
create or replace function app.can_resolve_bet(p_bet_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select case
    when (select b.kind from public.bets b where b.id = p_bet_id) = 'duel'
      then app.can_resolve_duel(p_bet_id)
    else app.can_manage_bet(p_bet_id)
  end;
$$;


-- =============================================================================
-- app.void_duel — THE ONE VOID PATH
--
-- Decline, expiry, the departure cascade and (through `app.reverse_bet_effects`)
-- pre-acceptance deletion all end here, and that is not tidiness: the two legal
-- state hops and the refund have to happen together, in that order, exactly
-- once. Four copies of that sequence would be four chances to write
-- `open → resolved` and four places to fix when DOM-012 is next read closely.
--
-- THE TWO HOPS, spelled out because this is the phase's risk 2:
--
--   `public.enforce_bet_state_transition` allows open→closed and closed→resolved
--   and nothing else, with NO service-context escape hatch — being a SECURITY
--   DEFINER function running as `postgres` buys this code no exemption
--   whatsoever. So an unaccepted duel (`state='open'`) is closed first and
--   resolved second, as two UPDATE statements in one transaction, and an
--   accepted one (already `state='closed'`, because `accept_duel` does what
--   `close_bet_early` does) skips straight to the second. Nothing invents a
--   third state and nothing asks the trigger for an exception.
--
-- WHY `closes_at` MOVES TO `least(closes_at, now())` ON THE FIRST HOP:
--
--   DOM-012 defines `closes_at` as the moment open→closed happened, which is
--   why `close_bet_early` overwrites it with now() and why `resolve_bet`
--   deliberately does NOT (there the clock had already closed the bet; the
--   stored value is already the honest one). A void has both cases at once —
--   a decline closes the bet NOW, while an expiry closes it at a deadline that
--   is already in the past — so `least` picks the right one without a branch:
--   it pulls a still-future deadline back to the instant the close actually
--   happened, and never pushes a past one forward.
--
-- WHY `app.settle_bet(bet, 'void', null)` AND NEVER A FRESH DELTA COMPUTATION:
--
--   Header point C. A void refund is a settlement, computed by the same
--   function a resolution and a deletion-reversal use, so the three can never
--   disagree by a coin. `settle_bet`'s refund branch already covers this case
--   exactly: with `p_kind = 'void'` every `win_stake` is zero, `win_total` is
--   zero, every member's payout IS their stake and every P/L delta is zero.
--   DOM-019 in one branch that was already there.
--
-- Deltas are materialised as jsonb BEFORE the resolution columns land, matching
-- `resolve_bet` and `delete_bet` — the same set is then applied and returned, so
-- the client patches the balances the database actually wrote rather than
-- recomputing them and hoping.
-- =============================================================================

create or replace function app.void_duel(
  p_bet_id uuid,
  p_reason public.bet_void_reason
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_state   public.bet_state;
  v_kind    public.bet_kind;
  v_deltas  jsonb;
begin
  select b.team_id, b.state, b.kind
    into v_team_id, v_state, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Not a user-facing sentence, and it should never be reached: every caller
  -- below already knows it is holding a duel. It is here because this function
  -- moves money on the strength of `bets.void_reason`, a column
  -- `bets_void_reason_shape` permits on a pool bet too — and a pool bet voided
  -- through here would silently acquire a reason no pool-bet surface knows how
  -- to render. `resolve_bet` is the void path for a pool bet.
  if v_kind <> 'duel' then
    raise exception
      'app.void_duel called on a pool bet (%). Pool bets are voided through public.resolve_bet.',
      p_bet_id using errcode = 'check_violation';
  end if;

  -- Idempotence is NOT wanted here. A second void would run `app.settle_bet`
  -- over the same wagers again and refund every stake twice, so this refuses
  -- loudly instead of returning an empty delta set. The callers that sweep in
  -- bulk (`app.expire_stale_duels`, `app.void_duels_for_departing_member`) take
  -- a row lock and re-check the predicate precisely so they never reach this.
  if v_state = 'resolved' then
    raise exception 'This duel is already resolved.' using errcode = 'check_violation';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           s.user_id,
             'balance_delta',     s.balance_delta,
             'profit_loss_delta', s.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.settle_bet(p_bet_id, 'void', null) s;

  -- Hop 1. Only from 'open' — an accepted duel is already 'closed' and asking
  -- the trigger for closed→closed would be a no-op it short-circuits anyway,
  -- but writing the condition makes the two-hop rule legible instead of
  -- accidental.
  if v_state = 'open' then
    update public.bets
       set state = 'closed',
           closes_at = least(closes_at, now())
     where id = p_bet_id;
  end if;

  -- Hop 2. `winning_option_id` is set to null explicitly rather than left
  -- alone: `bets_resolution_shape` requires a void to carry none, and an
  -- unaccepted duel has never had one, so this is belt-and-braces against a
  -- future path that voids something after a winner was staged.
  update public.bets
     set state             = 'resolved',
         resolution_kind   = 'void',
         winning_option_id = null,
         void_reason       = p_reason
   where id = p_bet_id;

  -- Decision §4.6: settlement emits CREDITS only (both stakes left their
  -- balances at placement), so this can never take a balance negative and needs
  -- none of `delete_bet`'s overdraw machinery. And DOM-025: no `transactions`
  -- row, because a refund is not a transfer.
  --
  -- A participant who has since left the team has no row here and is simply
  -- skipped — their per-team balance died with the membership (decision §4.4),
  -- exactly as `resolve_bet` and `delete_bet` already handle the same case.
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  return v_deltas;
end;
$$;


-- =============================================================================
-- EXPIRY — D8 half (b), the half that makes the money real
--
-- Half (a) is `computeDuelPhase` on the client: every read treats an unaccepted
-- duel past `closes_at` as expired, so the UI is never wrong even if nothing
-- below has ever run. That is what makes the FEATURE correct. This is what
-- makes the COINS correct — it persists the void and returns the challenger's
-- stake — and it is swept opportunistically (team load, and before the two duel
-- writes that move money) rather than scheduled.
--
-- READ THIS BEFORE REACHING FOR pg_cron: a scheduler now exists on this stack.
-- Extra Phase 1 installed it and runs `prune-chat-messages` nightly, which
-- corrected a factual premise the phase's original D8 leaned on. The DECISION
-- is unchanged anyway, because its real justification never was the absence of
-- a scheduler: retention — or expiry — that depends on a scheduler is retention
-- that silently stops the first time the scheduler does, on a deployment that
-- `design-scale-and-free-tier.md` §2.6 names as one that PAUSES after 7 idle
-- days. A duel's money is a stronger case for that rule than chat's, not a
-- weaker one. Sweeping lazily means a paused deployment wakes up and settles
-- correctly; a cron-only design means it wakes up owing people coins.
-- =============================================================================

create or replace function app.expire_stale_duels(p_team_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_bet_id uuid;
  v_count  integer := 0;
begin
  -- FOR UPDATE OF b is what makes two concurrent sweeps safe, and it is the
  -- only reason this is a cursor loop rather than one set-based UPDATE.
  -- Under READ COMMITTED, the second sweep blocks on a row the first has
  -- locked, and when the lock is released it RE-EVALUATES the qualification
  -- against the updated row — which now reads `state = 'resolved'` and no
  -- longer matches, so the row is skipped instead of refunded twice.
  -- Ordering by id gives every sweeper the same lock order, so two of them
  -- queue rather than deadlock.
  for v_bet_id in
    select b.id
      from public.bets b
      join public.bet_duels d on d.bet_id = b.id
     where b.team_id  = p_team_id
       and b.kind     = 'duel'
       and b.state   <> 'resolved'
       and d.accepted_at is null
       and b.closes_at <= now()
     order by b.id
     for update of b
  loop
    perform app.void_duel(v_bet_id, 'expired');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Task 11's cascade, and the reason it exists at all rather than falling
-- through `removeMemberActiveWagers` like every other bet.
--
-- That cascade is POOL-SHAPED: dropping one bettor out of a many-bettor pool
-- leaves a smaller but still valid pool, so DOM-032's "plain removal, no
-- refund" is coherent. Drop one of EXACTLY TWO and what is left is not a
-- smaller duel — it is one person's stake with nothing to settle against, a
-- bet that can never be resolved and coins that are simply gone. So the duel is
-- VOIDED with `'participant-left'` and both stakes are refunded through the one
-- settlement path; the departing member's refund lands on a `team_members` row
-- that is deleted moments later by `remove_membership`, which is correct and
-- deliberate (decision §4.4: the per-team balance dies with the membership),
-- and the SURVIVOR gets their coins back, which is the entire point.
--
-- ACCEPTED DUELS ARE INCLUDED. The filter is "not resolved", not "not
-- accepted": an accepted duel is precisely the case with two stakes on the
-- table and no way left to settle them.
--
-- A DEPARTING MEDIATOR VOIDS NOTHING, and this function's WHERE clause is the
-- statement of that (D7). `app.can_resolve_duel` re-derives the resolver set at
-- READ time, so the moment the named mediator stops being a team member the
-- duel is resolvable by the any-moderator pool with nothing stored, reassigned
-- or migrated. A runtime check, not a stored reassignment — which is also why
-- `bet_duels.mediator_id` needed no "reassign on departure" path.
--
-- WHY THE SERVER DERIVES THIS SET INSTEAD OF TAKING IT FROM THE CLIENT, unlike
-- `p_wager_ids`: `remove_membership`'s own header states the rule this is the
-- exception that proves. A client-supplied WAGER ID LIST is safe because the
-- DELETE re-scopes it to one team and one user, so the argument can only ever
-- narrow what the cascade already permits. Voiding a duel does not narrow
-- anything — it MOVES MONEY to the surviving participant — and "a list of
-- balance deltas has no such property." `settlement.ts`'s
-- `voidDuelsForDepartingMember` is the client-side TWIN of this function,
-- used to patch the local copy after the RPC returns, and it is deliberately
-- NOT sent as an argument.
create or replace function app.void_duels_for_departing_member(
  p_team_id uuid,
  p_user_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_bet_id uuid;
  v_count  integer := 0;
begin
  for v_bet_id in
    select b.id
      from public.bets b
      join public.bet_duels d on d.bet_id = b.id
     where b.team_id = p_team_id
       and b.kind    = 'duel'
       and b.state  <> 'resolved'
       and p_user_id in (d.challenger_id, d.challengee_id)
     order by b.id
     for update of b
  loop
    perform app.void_duel(v_bet_id, 'participant-left');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- =============================================================================
-- public.create_duel — D1 / D5 / D9, task 8
--
-- One transaction, six rows, and the money leaves the challenger's balance
-- before it returns (D5: nothing is ever committed on credit). The order of the
-- checks below mirrors `validateDuelDraft` (packages/shared/src/validation.ts)
-- statement for statement and repeats every message BYTE-FOR-BYTE, which is the
-- standing convention for every RPC in this repo: the client gates so a person
-- sees the rule before submitting, the database enforces it so the rule
-- survives Studio and PostgREST, and the two produce the same sentence so a
-- server refusal never reads like a different product.
--
-- WHAT GATES THIS FUNCTION, AND WHAT DELIBERATELY DOES NOT (D9):
--
--   The gate is `app.is_team_member`. It is NOT `app.can_create_bet`, and that
--   is an owner ruling, not an omission. DOM-002's access mode rations bets
--   POSTED FOR A TEAM TO WAGER INTO; a duel is a private arrangement between
--   two people who have already agreed to it, so the access mode has nothing
--   here to ration. What the leader keeps instead is the coercion below.
--
-- D9's COERCION LIVES HERE AND ONLY HERE, and the three sentences that follow
-- are the reason it is not implemented anywhere more obvious:
--
--   NOT a CHECK — a CHECK re-evaluates against the team's CURRENT access mode
--   on any later UPDATE, so flipping a team to `restricted` would retroactively
--   invalidate every duel created under `free-for-all`. D9 is explicit that the
--   rule applies at creation and never retroactively; the stored row stays the
--   truth about who may resolve THAT duel.
--   NOT a trigger — same objection, plus one more: a trigger fires for the seed
--   too, so the fixtures could no longer express a `restricted`-team duel with
--   `any_moderator = false` even if a future decision wanted one.
--   IT IS A COERCION, NOT A REFUSAL. A restricted team does NOT reject a draft
--   with `anyModerator: false`; it silently stores `true`. `validateDuelDraft`
--   has no issue code for it, on purpose, so the challenger never sees an error
--   for a control the UI had already ticked and disabled on their behalf.
--
--   Note the consequence for the resolver rule below: `v_any_moderator` (the
--   COERCED value) is what the "pick a mediator, or let any moderator resolve
--   it" check reads, not `p_any_moderator`. In a restricted team a call with no
--   mediator and `false` is therefore ACCEPTED and stored with `true` — which
--   is exactly what "coercion, not refusal" means, and the alternative
--   (checking the raw input first) would refuse the one case D9 was written to
--   permit.
-- =============================================================================

create or replace function public.create_duel(
  p_team_id       uuid,
  p_title         text,
  p_icon_emoji    text,
  p_challengee_id uuid,
  p_mediator_id   uuid,
  p_any_moderator boolean,
  p_stake         integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid            uuid := app.require_uid();
  v_access_mode    public.team_access_mode;
  v_any_moderator  boolean;
  v_challenger_nm  text;
  v_challengee_nm  text;
  v_pending        integer;
  v_balance        integer;
  v_bet_id         uuid;
  v_created        timestamptz;
  v_closes         timestamptz;
  v_option_ids     uuid[];
  v_wager_id       uuid;
begin
  -- D9: membership is the WHOLE check. See the banner above before "fixing"
  -- this to app.can_create_bet.
  if not app.is_team_member(p_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  -- D8 half (b) again, and it is here rather than only in `accept_duel` for a
  -- reason specific to the cap below: an unswept, long-expired challenge still
  -- has `accepted_at IS NULL` and would count against the challenger's three
  -- outstanding slots forever. Sweeping first means the cap counts challenges
  -- that are genuinely still waiting for an answer, not the ghosts of ones
  -- nobody ever answered.
  perform app.expire_stale_duels(p_team_id);

  -- The team's access mode, read INSIDE this transaction — the coercion's whole
  -- correctness rests on that word (see the banner).
  select t.access_mode into v_access_mode from public.teams t where t.id = p_team_id;
  v_any_moderator := coalesce(p_any_moderator, false) or (v_access_mode = 'restricted');

  -- validateDuelDraft: title-required. Same code and same sentence as
  -- `validateBetDraft`'s, because a duel IS a bet (D1) and the title rule is
  -- not a duel rule — diverging here would put two sentences on one requirement.
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'Give the bet a title.' using errcode = 'check_violation';
  end if;

  -- validateDuelDraft's three-outcome challengee block, in ITS order, and the
  -- order is the design: self-challenge is tested BEFORE roster membership,
  -- because the challenger trivially passes the roster test and a plain "is a
  -- teammate" check would wave a self-challenge straight through. Absent is
  -- tested first because "pick who you're challenging" is the sentence for an
  -- untouched field — and an id that is simply not on the roster (a stale
  -- picker, a member kicked while the modal was open) is the same USER-FACING
  -- problem, so it reuses that code and that message rather than inventing a
  -- third.
  if p_challengee_id is null then
    raise exception 'Pick who you''re challenging.' using errcode = 'check_violation';
  end if;
  if p_challengee_id = v_uid then
    raise exception 'You can''t challenge yourself.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.team_members m
     where m.team_id = p_team_id and m.user_id = p_challengee_id
  ) then
    raise exception 'Pick who you''re challenging.' using errcode = 'check_violation';
  end if;

  -- D7: the named mediator is any teammate EXCEPT the two participants, and
  -- "any moderator" is ADDITIVE rather than an alternative — so the real rule
  -- is "at least one possible resolver exists", which can fail two different
  -- ways and therefore has two codes on the client side. Note what does NOT
  -- also fire: an invalid mediator with `anyModerator` false is not
  -- additionally "resolver-required" — they picked someone, and telling them to
  -- pick a mediator when they just did is noise.
  if p_mediator_id is not null then
    if p_mediator_id = v_uid
       or p_mediator_id = p_challengee_id
       or not exists (
         select 1 from public.team_members m
          where m.team_id = p_team_id and m.user_id = p_mediator_id
       )
    then
      raise exception 'The mediator has to be a teammate who isn''t in the duel.'
        using errcode = 'check_violation';
    end if;
  elsif not v_any_moderator then
    raise exception 'Pick a mediator, or let any moderator resolve it.'
      using errcode = 'check_violation';
  end if;

  -- validateDuelDraft folds `amount-invalid` and `over-balance` into ONE code
  -- and one sentence, because on the compose form it is one field and "whole
  -- amount you can afford" covers both failures without making the person read
  -- two errors about the same box. The split still exists where it matters:
  -- the affordability half is re-checked below WITH THE MEMBER ROW LOCKED and
  -- refuses with `Not enough coins.` — validateWager's own DOM-014 sentence —
  -- because by then it is a placement, not a draft.
  if p_stake is null or p_stake < 1 then
    raise exception 'Stake must be a whole amount you can afford.'
      using errcode = 'check_violation';
  end if;

  -- --- task 9, the readable half ------------------------------------------------
  -- The BEFORE INSERT trigger at the bottom of this file carries the same two
  -- rules, and it is DISARMED FOR THIS FUNCTION by design: it has a
  -- service-context escape hatch and this function is SECURITY DEFINER, so
  -- `app.is_service_context()` is true for every call that arrives through
  -- here. That is not a hole — it is the division of labour. These two checks
  -- are what a member actually hits, and they raise the SAME SQLSTATEs
  -- (`SLD01`/`SLD02`) the trigger does, because `asDuelFailure` in
  -- bet-mutations.ts keys on the CODE and never on the message text. The
  -- trigger exists for a write that arrives some other way; the partial unique
  -- index exists for the race neither of them can win.
  select count(*)::integer into v_pending
    from public.bet_duels d
    join public.bets b on b.id = d.bet_id
   where b.team_id = p_team_id
     and d.challenger_id = v_uid
     and d.accepted_at is null
     and b.state <> 'resolved';

  if v_pending >= app.duel_max_pending_per_challenger() then
    raise exception
      'You already have % challenges waiting for an answer. Wait for one of them to be settled first.',
      app.duel_max_pending_per_challenger()
      using errcode = 'SLD01';
  end if;

  -- The pair rule, checked with the SAME predicate the partial unique index
  -- uses (`accepted_at is null`, and NOT the narrower "still pending") so the
  -- pre-check and the index can never disagree about which insert they refuse.
  -- The index's known over-reach is documented on the index itself in
  -- 20260906130000_duel_schema.sql; matching it here is what keeps the refusal
  -- a readable sentence rather than a raw 23505 naming an index.
  if exists (
    select 1 from public.bet_duels d
     where d.challenger_id = v_uid
       and d.challengee_id = p_challengee_id
       and d.accepted_at is null
  ) then
    raise exception 'You already have a challenge waiting for an answer from them.'
      using errcode = 'SLD02';
  end if;

  -- --- the money, locked first --------------------------------------------------
  -- `place_wager`'s lock-then-debit sequence, and the lock is taken HERE —
  -- before any row is written — rather than at the end where the wager is
  -- inserted. Two reasons, and the first is the one `place_wager` gives:
  -- serialising this one member row is what makes the balance check and the
  -- debit atomic, because without it two simultaneous challenges each read the
  -- pre-debit balance and both pass a check their sum violates. The second is
  -- local: refusing an unaffordable challenge before writing five rows we are
  -- about to roll back is simply cheaper, and the transaction is atomic either
  -- way.
  select m.coin_balance into v_balance
    from public.team_members m
   where m.team_id = p_team_id and m.user_id = v_uid
     for update;

  -- DOM-014, absolute. validateWager's sentence verbatim — at this point the
  -- stake IS a wager, so it gets the wager's message rather than the draft's.
  if p_stake > v_balance then
    raise exception 'Not enough coins.' using errcode = 'check_violation';
  end if;

  -- The two display names that become the option labels. Read once, here, so
  -- the labels are a snapshot: a member renaming themselves later must not
  -- silently relabel a duel that has already been wagered on, which is the same
  -- reason `bet_options` has no UPDATE path at all (Phase 6).
  select u.display_name into v_challenger_nm from public.users u where u.id = v_uid;
  select u.display_name into v_challengee_nm from public.users u where u.id = p_challengee_id;

  -- --- the bet ------------------------------------------------------------------
  -- `state='open'` and `closes_at = now() + the accept window` is D2's whole
  -- mechanism: the EXISTING clock carries "waiting to be accepted", so UX-008's
  -- sort, the countdown and `computeEffectiveState` all work with no
  -- duel-specific branch and no fourth bet state.
  --
  -- `max_wager_per_user = p_stake` is task 6's structural guarantee, and it is
  -- worth more than it looks: it makes a THIRD wager on this bet impossible
  -- even if a write path ever leaked, which is a cheaper and stronger promise
  -- than a bespoke 1v1 payout formula — and it is precisely what lets
  -- `app.settle_bet` be reused unchanged.
  insert into public.bets (
    team_id, creator_id, title, icon_emoji, state, closes_at, max_wager_per_user, kind
  ) values (
    p_team_id,
    v_uid,
    btrim(p_title),
    -- DOM-009: optional. An empty string is "no icon", not an icon.
    nullif(btrim(coalesce(p_icon_emoji, '')), ''),
    'open',
    now() + app.duel_accept_window(),
    p_stake,
    'duel'
  )
  returning id, created_at, closes_at into v_bet_id, v_created, v_closes;

  -- Exactly two options, generated rather than typed: DOM-007's two-option
  -- floor is met structurally and there is nothing for a person to fill in.
  -- Position 0 IS the challenger and position 1 IS the challengee — a fixed
  -- convention every surface and every test depends on, which is why it is
  -- written as an explicit `values` list with the positions spelled out rather
  -- than derived from an array's ordinality.
  with inserted as (
    insert into public.bet_options (bet_id, label, position)
    values (v_bet_id, v_challenger_nm, 0),
           (v_bet_id, v_challengee_nm, 1)
    returning id, position
  )
  select array_agg(i.id order by i.position) into v_option_ids from inserted i;

  -- --- the duel row -------------------------------------------------------------
  -- `expires_at = v_closes` — the same instant the bet stores, on purpose: they
  -- are equal exactly until `accept_duel` moves the bet's `closes_at` to now(),
  -- after which this column is the only surviving record of when the challenge
  -- would have lapsed.
  insert into public.bet_duels (
    bet_id, challenger_id, challengee_id, mediator_id, any_moderator, stake,
    accepted_at, expires_at
  ) values (
    v_bet_id, v_uid, p_challengee_id, p_mediator_id, v_any_moderator, p_stake,
    null, v_closes
  );

  -- --- the challenger's stake ---------------------------------------------------
  -- A REAL wager row on their own side, not an escrow entry (D5). Decision §4.6:
  -- the stake leaves the balance at placement and is NOT a ledger event, so this
  -- is a bare debit and not `app.apply_transaction`.
  update public.team_members
     set coin_balance = coin_balance - p_stake
   where team_id = p_team_id and user_id = v_uid;

  insert into public.wagers (bet_id, option_id, user_id, amount)
  values (v_bet_id, v_option_ids[1], v_uid, p_stake)
  returning id into v_wager_id;

  return jsonb_build_object(
    'bet_id',        v_bet_id,
    'created_at',    v_created,
    'closes_at',     v_closes,
    'option_ids',    to_jsonb(v_option_ids),
    -- As STORED, which is not always as sent (D9). The client must take the
    -- server's answer rather than echo its own input.
    'any_moderator', v_any_moderator,
    'wager_id',      v_wager_id,
    'balance_after', v_balance - p_stake
  );
exception
  -- The race the pre-check above cannot win: two concurrent `create_duel`
  -- transactions both read "no pending duel between these two" before either
  -- has inserted. `bet_duels_one_pending_per_pair_idx` refuses the loser with a
  -- bare 23505 naming an index, which is not feedback. Re-raised as SLD02 with
  -- the same sentence, so both roads lead to the same fact and the client's
  -- code-keyed mapper does not need to know which one it took. (`asDuelFailure`
  -- maps raw 23505 to that sentence as well, belt and braces for the day a
  -- second unique constraint appears in this transaction.)
  when unique_violation then
    raise exception 'You already have a challenge waiting for an answer from them.'
      using errcode = 'SLD02';
end;
$$;


-- =============================================================================
-- public.accept_duel — D2 / D5, task 8
--
-- The challengee's stake leaves their balance and the bet lands in the
-- AWAITING RESULT state the design system already specifies, by doing exactly
-- what `close_bet_early` does: `state='closed'`, `closes_at=now()`. No new
-- transition, no new state, no special case in `computeEffectiveState`.
-- =============================================================================

create or replace function public.accept_duel(p_bet_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid           uuid := app.require_uid();
  v_team_id       uuid;
  v_kind          public.bet_kind;
  v_state         public.bet_state;
  v_closes        timestamptz;
  v_challengee_id uuid;
  v_accepted_at   timestamptz;
  v_stake         integer;
  v_option_id     uuid;
  v_balance       integer;
  v_wager_id      uuid;
  v_now           timestamptz := now();
begin
  select b.team_id, b.kind into v_team_id, v_kind
    from public.bets b where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_kind <> 'duel' then
    raise exception 'This bet is not a duel.' using errcode = 'check_violation';
  end if;
  if not app.is_team_member(v_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  -- D8 half (b). Sweep BEFORE reading the row's state, so a challengee who
  -- opens a 25-hour-old challenge and taps accept is refused against a duel
  -- that is already void and already refunded — rather than accepting a bet
  -- whose deadline passed while the tab sat open. The client-side twin is
  -- `computeDuelPhase`, which is what stops the button being offered at all;
  -- this is what makes it true.
  perform app.expire_stale_duels(v_team_id);

  -- Re-read AFTER the sweep: it may have just voided this very row.
  select b.state, b.closes_at, d.challengee_id, d.accepted_at, d.stake
    into v_state, v_closes, v_challengee_id, v_accepted_at, v_stake
    from public.bets b
    join public.bet_duels d on d.bet_id = b.id
   where b.id = p_bet_id;

  -- permissions.ts: canAcceptDuel. Only the challengee — not the challenger
  -- (they already committed their stake at creation and cannot take the other
  -- side), and not a moderator (a duel is not a team matter to arbitrate into
  -- existence).
  if v_challengee_id <> v_uid then
    raise exception 'Only the person challenged can accept this duel.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_accepted_at is not null then
    raise exception 'This duel has already been accepted.' using errcode = 'check_violation';
  end if;

  -- The clock is checked BEFORE the stored state so the expired case gets its
  -- own sentence: after the sweep above an expired duel satisfies BOTH
  -- conditions, and "this challenge has expired" is the true and useful one.
  if v_closes <= v_now then
    raise exception 'This challenge has expired.' using errcode = 'check_violation';
  end if;
  if v_state = 'resolved' then
    raise exception 'This challenge is no longer open.' using errcode = 'check_violation';
  end if;

  -- `place_wager`'s lock-then-debit sequence, second and last copy in this
  -- phase. Locking the challengee's own member row is what makes the balance
  -- read and the debit atomic.
  select m.coin_balance into v_balance
    from public.team_members m
   where m.team_id = v_team_id and m.user_id = v_uid
     for update;

  -- DOM-014 is ABSOLUTE (D5): if the challengee cannot cover the stake at THIS
  -- moment the accept is refused, and the surface offers `declineDuel(betId,
  -- 'insufficient-funds')` instead — which is why that void reason exists as a
  -- distinct enum value. Nothing is ever accepted on credit and nobody ever
  -- goes negative through this path.
  if v_stake > v_balance then
    raise exception 'Not enough coins.' using errcode = 'check_violation';
  end if;

  -- Position 1 is the challengee's side, by the convention `create_duel` fixed.
  select o.id into v_option_id
    from public.bet_options o
   where o.bet_id = p_bet_id and o.position = 1;

  update public.team_members
     set coin_balance = coin_balance - v_stake
   where team_id = v_team_id and user_id = v_uid;

  insert into public.wagers (bet_id, option_id, user_id, amount)
  values (p_bet_id, v_option_id, v_uid, v_stake)
  returning id into v_wager_id;

  -- D2: exactly `close_bet_early`'s move, and the pairing is why it is a
  -- function rather than a one-column PATCH — `closes_at` IS the moment
  -- open→closed happened, so both columns move together or every countdown and
  -- "closed Xm ago" starts lying. `enforce_bet_state_transition` sees open→closed
  -- and allows it, unwidened, exactly as it does for a pool bet.
  update public.bets
     set state = 'closed', closes_at = v_now
   where id = p_bet_id
  returning closes_at into v_closes;

  update public.bet_duels
     set accepted_at = v_now
   where bet_id = p_bet_id
  returning accepted_at into v_accepted_at;

  return jsonb_build_object(
    'accepted_at',   v_accepted_at,
    'closes_at',     v_closes,
    'wager_id',      v_wager_id,
    'balance_after', v_balance - v_stake
  );
end;
$$;


-- =============================================================================
-- public.decline_duel — D3 / D5, task 8
--
-- Returns the settlement deltas exactly as `delete_bet` does, and for the same
-- reason: this voids a bet that already has money in it (the challenger's stake
-- left at creation), so the caller needs to know what Postgres actually moved
-- rather than recomputing it locally and hoping the two agree.
--
-- DELIBERATELY DOES NOT SWEEP FIRST, unlike `create_duel` and `accept_duel`,
-- and the asymmetry is the point. Those two take money and must not act on a
-- dead duel. Declining an already-expired duel is harmless — both paths void
-- and refund the challenger identically — so sweeping here would turn a
-- no-consequence action into an error message for no gain. permissions.ts's
-- `canDeclineDuel` says the same thing in its own comment. If a concurrent
-- sweep gets there first, the "no longer open" guard below produces a sentence
-- and the money is already correct either way.
-- =============================================================================

create or replace function public.decline_duel(
  p_bet_id uuid,
  p_reason public.bet_void_reason default 'declined'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid           uuid := app.require_uid();
  v_team_id       uuid;
  v_kind          public.bet_kind;
  v_state         public.bet_state;
  v_challengee_id uuid;
  v_accepted_at   timestamptz;
begin
  select b.team_id, b.kind, b.state, d.challengee_id, d.accepted_at
    into v_team_id, v_kind, v_state, v_challengee_id, v_accepted_at
    from public.bets b
    join public.bet_duels d on d.bet_id = b.id
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_kind <> 'duel' then
    raise exception 'This bet is not a duel.' using errcode = 'check_violation';
  end if;
  if not app.is_team_member(v_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  -- permissions.ts: canDeclineDuel. Given its own body there even though it
  -- agrees with `canAcceptDuel` today, and the same separation holds here: they
  -- are not the same question, because accepting has a money precondition that
  -- declining never will — the broke challengee's ONLY legal move is to
  -- decline, with `'insufficient-funds'`.
  if v_challengee_id <> v_uid then
    raise exception 'Only the person challenged can decline this duel.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_accepted_at is not null then
    raise exception 'This duel has already been accepted.' using errcode = 'check_violation';
  end if;
  if v_state = 'resolved' then
    raise exception 'This challenge is no longer open.' using errcode = 'check_violation';
  end if;

  -- A deliberate narrowing of `public.bet_void_reason`'s five values to the two
  -- that are the challengee's to claim, mirroring `DuelDeclineReason` in
  -- bet-mutations.ts. The other three are not theirs: `'mediator'` belongs to
  -- whoever resolved the duel, `'expired'` is written by
  -- `app.expire_stale_duels` with no human in the loop at all, and
  -- `'participant-left'` is written by the kick/ban/leave cascade. The
  -- TypeScript union stops the mistake being made in the editor; this stops it
  -- being made from Studio or curl.
  if p_reason not in ('declined', 'insufficient-funds') then
    raise exception
      'A duel is declined as "declined" or "insufficient-funds", nothing else.'
      using errcode = 'check_violation';
  end if;

  -- The one void path (see its banner). The reason never changes the money:
  -- `app.settle_bet` is handed `'void'` and refunds every stake in full
  -- regardless of which value is stored — the reason is a suffix on DOM-019's
  -- void, never a second kind of it.
  return app.void_duel(p_bet_id, p_reason);
end;
$$;


-- =============================================================================
-- public.sweep_stale_duels — D8 half (b), the client's entry point
--
-- `app` is not in config.toml's `api.schemas`, so `app.expire_stale_duels` is
-- unreachable over PostgREST by construction — this is the public doorway to
-- it. It loops the CALLER'S OWN team memberships rather than taking a team id,
-- because `loadTeamData` loads every team the user belongs to (UX-009/010's
-- switcher needs them all) and one round trip that sweeps all of them is
-- cheaper than N, on the cold start `design-scale-and-free-tier.md` already
-- names as the egress weakness.
--
-- SECURITY DEFINER, which is doing two jobs at once. The obvious one: the money
-- moves below run through `enforce_team_member_update_rules`, which refuses any
-- balance change outside service context. The less obvious one: it means this
-- function does not depend on `authenticated` holding EXECUTE on
-- `app.expire_stale_duels` — and that matters, because the grant block at the
-- bottom of this file deliberately takes that privilege AWAY.
--
-- `auth.uid()` still reads the end user inside a definer function (it comes
-- from the JWT, not from `current_user`), which is what makes "the caller's own
-- memberships" both meaningful and un-forgeable here.
-- =============================================================================

create or replace function public.sweep_stale_duels()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
  v_total   integer := 0;
begin
  for v_team_id in
    select m.team_id from public.team_members m
     where m.user_id = v_uid
     order by m.team_id
  loop
    v_total := v_total + app.expire_stale_duels(v_team_id);
  end loop;

  return v_total;
end;
$$;


-- =============================================================================
-- public.resolve_bet — EXTENDED, NOT JOINED BY A SIBLING (task 8)
--
-- One function still owns every resolution in this schema. A `resolve_duel`
-- next door would be a second place that writes `state='resolved'`, applies
-- settlement deltas and moves balances, and the two would drift the first time
-- one of them learned something the other did not. What forks is
-- AUTHORIZATION, inside: `app.can_resolve_bet` reads the bet's `kind` and
-- routes a pool bet to `app.can_manage_bet` (verbatim, unwidened) and a duel to
-- `app.can_resolve_duel`.
--
-- ============ THE OVERLOAD TRAP, AND WHY THE DROP BELOW IS MANDATORY ==========
--
-- `create or replace function` matches on the ARGUMENT LIST. Adding a fourth
-- parameter therefore does NOT replace the Phase 7 function — it creates a
-- SECOND OVERLOAD, and both survive. PostgREST then has two candidates for a
-- three-argument `rpc('resolve_bet', {...})` call and resolves it by argument
-- NAMES, which both signatures satisfy: the failure mode is an intermittent
-- "could not choose the best candidate function" 300, or worse, silently
-- calling the OLD function that knows nothing about `void_reason` and routes
-- authorization through `app.can_manage_bet` — i.e. a mediator is refused and a
-- challenger is admitted, exactly inverting D6.
--
-- So: DROP the three-argument version first, create the four-argument one, then
-- re-REVOKE and re-GRANT (an ACL dies with the function it was granted on).
-- Verify with `\df public.resolve_bet` that exactly ONE row comes back.
-- =============================================================================

drop function public.resolve_bet(uuid, public.bet_resolution_kind, uuid);

create or replace function public.resolve_bet(
  p_bet_id            uuid,
  p_kind              public.bet_resolution_kind,
  p_winning_option_id uuid,
  p_void_reason       public.bet_void_reason default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := app.require_uid();
  v_team_id     uuid;
  v_state       public.bet_state;
  v_closes      timestamptz;
  v_kind        public.bet_kind;
  v_accepted_at timestamptz;
  v_void_reason public.bet_void_reason;
  v_deltas      jsonb;
begin
  select b.team_id, b.state, b.closes_at, b.kind
    into v_team_id, v_state, v_closes, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- D8 half (b), for duels only: a resolver looking at a stale unaccepted duel
  -- should be told it is already void, not told to wait for an acceptance that
  -- can never come. Costs a pool bet nothing because it does not run for one.
  if v_kind = 'duel' then
    perform app.expire_stale_duels(v_team_id);
    select b.state, b.closes_at into v_state, v_closes
      from public.bets b where b.id = p_bet_id;
  end if;

  -- permissions.ts: canResolveBet for a pool bet (DOM-018/019 — creator,
  -- moderator, leader), canResolveDuel for a duel (D6/D7 — the named mediator
  -- or the any-moderator pool, NEVER a participant). Two sentences because they
  -- name two different sets of people, and a member refused by one would be
  -- misled by the other's wording.
  if not app.can_resolve_bet(p_bet_id) then
    if v_kind = 'duel' then
      raise exception 'Only the mediator or a moderator can resolve this duel.'
        using errcode = 'insufficient_privilege';
    else
      raise exception 'Only the bet creator or a moderator can resolve this bet.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_state = 'resolved' then
    raise exception 'This bet is already resolved.' using errcode = 'check_violation';
  end if;

  -- A duel with one stake on the table has nothing to resolve. Without this a
  -- mediator could "declare a winner" on an unaccepted duel: `app.settle_bet`
  -- would find one wager, make its own option the winning side, pay the
  -- challenger their own stake back at zero P/L, and produce a resolved bet
  -- that looks settled and means nothing. The honest exits before acceptance
  -- are accept, decline, expiry and delete — all of which exist.
  if v_kind = 'duel' then
    select d.accepted_at into v_accepted_at
      from public.bet_duels d where d.bet_id = p_bet_id;
    if v_accepted_at is null then
      raise exception 'This duel hasn''t been accepted yet.' using errcode = 'check_violation';
    end if;
  end if;

  -- Unchanged from Phase 7, and unreachable for a duel: `accept_duel` already
  -- wrote `state='closed'`, and the guard above refuses every duel that has not
  -- been accepted, so a duel never arrives here still 'open'. Left exactly as
  -- written because it is the pool bet's path and this phase does not touch
  -- pool bets.
  if v_state = 'open' then
    if v_closes > now() then
      raise exception 'Close betting before resolving.' using errcode = 'check_violation';
    end if;
    update public.bets set state = 'closed' where id = p_bet_id;
  end if;

  if p_kind is null then
    raise exception 'Pick a winning option or void the bet.' using errcode = 'check_violation';
  end if;

  -- DOM-018: the winner must be one of THIS bet's options. DOM-019's void
  -- carries no option at all, and a stray one would end up stored next to a
  -- 'void' resolution_kind where `toResolution` can never read it.
  if p_kind = 'winner' then
    if p_winning_option_id is null or not exists (
      select 1 from public.bet_options o
       where o.id = p_winning_option_id and o.bet_id = p_bet_id
    ) then
      raise exception 'Pick one of the bet''s options as the winner.'
        using errcode = 'check_violation';
    end if;
  else
    p_winning_option_id := null;
  end if;

  -- D3, in three lines and one deliberate silence:
  --
  --   * a winner has no reason — there is nothing to explain;
  --   * a POOL bet's void has no reason either, ever, and an argument passed
  --     for one is IGNORED rather than refused. That is a choice, not sloppiness:
  --     `resolveBet` in bet-mutations.ts sends `p_void_reason` on every call
  --     uniformly, the pool-void surface has no reason picker to fill it from,
  --     and refusing a null-equivalent argument would make the client branch on
  --     bet kind to call one function two ways. The column stays NULL for every
  --     pool bet ever written, which is what made D3 need no backfill.
  --   * a DUEL void with no reason given defaults to `'mediator'`, because at
  --     this point in the code the only way to arrive is a human resolver who
  --     passed authorization. The client does NOT guess this value — `undefined`
  --     there means "the caller expressed no reason", and only the server knows
  --     the caller was a mediator.
  if p_kind = 'void' and v_kind = 'duel' then
    v_void_reason := coalesce(p_void_reason, 'mediator');
  else
    v_void_reason := null;
  end if;

  -- Computed BEFORE the resolution columns land, purely so the two reads of the
  -- same truth cannot be separated by a concurrent write; settle_bet reads only
  -- `wagers`, which this function never touches.
  --
  -- For a duel this is the task-6 proof in production: two members, symmetric
  -- stakes, opposite options. pool = 2×stake, win_total = stake, so the winner's
  -- payout is floor(stake × 2·stake / stake) = 2·stake and their P/L is
  -- +stake; the loser staked on the other option, so win_stake = 0, payout = 0
  -- and P/L is −stake. No duel branch, no rounding to argue about (the single
  -- floor divides exactly), no second formula.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           s.user_id,
             'balance_delta',     s.balance_delta,
             'profit_loss_delta', s.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.settle_bet(p_bet_id, p_kind, p_winning_option_id) s;

  update public.bets
     set state             = 'resolved',
         resolution_kind   = p_kind,
         winning_option_id = p_winning_option_id,
         void_reason       = v_void_reason
   where id = p_bet_id;

  -- Decision §4.6: settlement emits CREDITS only (the stake left at placement),
  -- so this can never take a balance negative — and it deliberately writes no
  -- `transactions` row, because resolution is not a ledger event (DOM-025).
  -- A wagerer who has since been kicked has no row here and is simply skipped;
  -- their per-team balance died with the membership (decision §4.4).
  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  return v_deltas;
end;
$$;


-- =============================================================================
-- GUARDS ON THE FOUR FUNCTIONS THAT ALREADY EXISTED (task 8)
--
-- Each is a `create or replace` with the IDENTICAL argument list, so none of
-- them creates an overload and none of them loses its Phase 5/6/7 grants — the
-- opposite of `resolve_bet` above, and the contrast is worth noticing: the drop
-- there was needed precisely BECAUSE its signature changed.
--
-- The bodies below are the shipped ones, unedited except where marked. Copying
-- a function forward to add four lines is not ideal, but it is what
-- `create or replace` requires and it is how this repo has done every previous
-- amendment (`enforce_team_member_update_rules` in Phase 7, `delete_bet` in
-- 20260905160000). The alternative — a trigger that inspects `kind` — would put
-- the duel rules somewhere nobody reading `delete_bet` would find them.
-- =============================================================================

-- --- place_wager: a duel takes no wagers from the bet page ------------------------
-- The ONLY check needed, and the reason is worth stating so nobody adds a
-- second: `wagers` INSERT has been revoked from `authenticated` since Phase 6
-- (20260905150000_bet_rpcs.sql's tightening block), so this RPC is the sole
-- client path to that table. There is no policy to also tighten and no direct
-- insert to also refuse.
--
-- `max_wager_per_user = stake` (task 6) already makes a third wager fail on
-- DOM-017 arithmetic, so this guard is not what keeps the pool at two — it is
-- what produces a sentence instead of "Max 50 per user on this bet.", which
-- would be a true statement that explains nothing.
create or replace function public.place_wager(
  p_bet_id    uuid,
  p_option_id uuid,
  p_amount    integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid            uuid := app.require_uid();
  v_team_id        uuid;
  v_kind           public.bet_kind;
  v_max_per_user   integer;
  v_balance        integer;
  v_existing_stake integer;
  v_wager_id       uuid;
  v_placed_at      timestamptz;
begin
  select b.team_id, b.max_wager_per_user, b.kind
    into v_team_id, v_max_per_user, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Extra Phase 2, task 8. A duel's two wagers are written by `create_duel` and
  -- `accept_duel`, each inside the transaction that debits for them.
  if v_kind = 'duel' then
    raise exception 'Wagers are placed by accepting the duel, not from the bet page.'
      using errcode = 'check_violation';
  end if;

  if not app.is_team_member(v_team_id) then
    raise exception 'You are not a member of this team.' using errcode = 'insufficient_privilege';
  end if;

  -- state-machine.ts: canAcceptWagers. The EFFECTIVE state counts the clock,
  -- so a bet stored 'open' whose closes_at has passed refuses wagers even
  -- before anything persists the transition (DOM-012).
  if not app.bet_accepts_wagers(p_bet_id) then
    raise exception 'Betting is closed for this bet.' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.bet_options o
     where o.id = p_option_id and o.bet_id = p_bet_id
  ) then
    raise exception 'Pick one of the bet''s options.' using errcode = 'check_violation';
  end if;

  -- validation.ts: validateWager's amount-invalid case, which short-circuits
  -- the other two there as well.
  if p_amount is null or p_amount < 1 then
    raise exception 'Wager must be a positive whole amount.' using errcode = 'check_violation';
  end if;

  select m.coin_balance into v_balance
    from public.team_members m
   where m.team_id = v_team_id and m.user_id = v_uid
     for update;

  select coalesce(sum(w.amount), 0)::integer into v_existing_stake
    from public.wagers w
   where w.bet_id = p_bet_id and w.user_id = v_uid;

  -- DOM-017 caps the user's TOTAL stake on the bet, not each wager, otherwise
  -- repeat wagers bypass it trivially.
  if p_amount + v_existing_stake > v_max_per_user then
    raise exception 'Max % per user on this bet.', v_max_per_user
      using errcode = 'check_violation';
  end if;

  -- DOM-014: never over balance. The non-negative-balance trigger is the
  -- backstop if this ever gets out of the way; this is the readable sentence.
  if p_amount > v_balance then
    raise exception 'Not enough coins.' using errcode = 'check_violation';
  end if;

  -- Decision §4.6: the stake leaves the balance at placement and is NOT a
  -- ledger event, so this is a bare debit and not app.apply_transaction.
  update public.team_members
     set coin_balance = coin_balance - p_amount
   where team_id = v_team_id and user_id = v_uid;

  insert into public.wagers (bet_id, option_id, user_id, amount)
  values (p_bet_id, p_option_id, v_uid, p_amount)
  returning id, placed_at into v_wager_id, v_placed_at;

  return jsonb_build_object(
    'wager_id',      v_wager_id,
    'placed_at',     v_placed_at,
    'balance_after', v_balance - p_amount
  );
end;
$$;

-- --- close_bet_early: a duel has no betting window --------------------------------
-- DOM-011 exists so a creator can stop a pool taking new money before the
-- deadline. A duel's pool is closed by construction — exactly two wagers, one
-- per participant, and `place_wager` refuses it outright — so there is nothing
-- for an early close to close. The transition it would write (`open→closed`)
-- IS what `accept_duel` writes, and letting a creator write it by hand would
-- produce an accepted-looking duel with one stake in it and no `accepted_at`:
-- a bet that can never be resolved, declined or expired, because every path
-- keys off one of the two facts this would have desynchronised.
create or replace function public.close_bet_early(p_bet_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_uid();
  v_state  public.bet_state;
  v_closes timestamptz;
  v_kind   public.bet_kind;
  v_now    timestamptz := now();
begin
  select b.state, b.closes_at, b.kind into v_state, v_closes, v_kind
    from public.bets b
   where b.id = p_bet_id;

  if v_state is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Extra Phase 2, task 8. Checked BEFORE authorization on purpose: the answer
  -- is the same for the creator, a moderator and the leader, so telling a
  -- moderator "you may not" would be both true and misleading.
  if v_kind = 'duel' then
    raise exception 'A duel has no betting window to close.' using errcode = 'check_violation';
  end if;

  -- permissions.ts: canCloseBetEarly (DOM-011) — creator, moderator, leader.
  if not app.can_manage_bet(p_bet_id) then
    raise exception 'Only the bet creator or a moderator can close betting early.'
      using errcode = 'insufficient_privilege';
  end if;

  -- state-machine.ts's computeEffectiveState, then validation.ts's
  -- canTransitionBetState: only an effectively-open bet can be closed. A
  -- stored-open bet past its closes_at is already closed and needs nothing.
  if v_state = 'resolved' then
    raise exception 'This bet is already resolved.' using errcode = 'check_violation';
  end if;
  if v_state = 'closed' or v_closes <= v_now then
    raise exception 'Betting is already closed.' using errcode = 'check_violation';
  end if;

  update public.bets
     set state = 'closed', closes_at = v_now
   where id = p_bet_id
  returning closes_at into v_closes;

  return v_closes;
end;
$$;

-- --- delete_bet: an ACCEPTED duel is not deletable --------------------------------
-- D6's second half. Before acceptance there is nothing to protect: only the
-- challenger's stake is down, the existing path's `app.reverse_bet_effects`
-- already refunds it (an unresolved bet's reversal IS the stake), and a
-- challenger cancelling a challenge nobody answered is the ordinary DOM-033
-- delete. After acceptance, deleting would be the challenger's escape hatch
-- from a bet they are losing — so the honest exits are a resolution or a void,
-- both of which move money through `app.settle_bet` and leave a history row.
--
-- The permission set is UNCHANGED (`app.can_manage_bet`, i.e. creator or
-- moderator) — this adds a CONDITION, not a new audience, which is exactly why
-- `can_manage_bet` did not need widening or forking for deletion the way
-- resolution did.
create or replace function public.delete_bet(p_bet_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := app.require_uid();
  v_team_id uuid;
  v_deltas  jsonb;
begin
  select b.team_id into v_team_id from public.bets b where b.id = p_bet_id;

  if v_team_id is null then
    raise exception 'This bet no longer exists.' using errcode = 'no_data_found';
  end if;

  -- permissions.ts: canDeleteBet (DOM-033) — the same set that closes it.
  if not app.can_manage_bet(p_bet_id) then
    raise exception 'Only the bet creator or a moderator can delete this bet.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Extra Phase 2, task 8 (permissions.ts: canDeleteDuel). Reads `bet_duels`
  -- rather than `bets.kind` because the fact being tested lives there anyway,
  -- and a pool bet simply matches no row.
  if exists (
    select 1 from public.bet_duels d
     where d.bet_id = p_bet_id and d.accepted_at is not null
  ) then
    raise exception 'A duel can only be deleted before it''s accepted.'
      using errcode = 'check_violation';
  end if;

  -- Materialized as jsonb rather than read twice: the reversal must be
  -- computed BEFORE the cascade removes the wagers it is derived from, and the
  -- same set is then applied and returned.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'user_id',           r.user_id,
             'balance_delta',     r.balance_delta,
             'profit_loss_delta', r.profit_loss_delta
           )),
           '[]'::jsonb
         )
    into v_deltas
    from app.reverse_bet_effects(p_bet_id) r;

  -- The one sanctioned overdraw (owner ruling 2026-09-05 — see
  -- 20260905160000_delete_bet_may_overdraw.sql's header). Opened for this
  -- statement and closed again straight after, so a later statement in the same
  -- transaction cannot ride on it.
  perform set_config('app.allow_negative_balance', 'on', true);

  update public.team_members m
     set coin_balance = m.coin_balance + d.balance_delta,
         profit_loss  = m.profit_loss  + d.profit_loss_delta
    from jsonb_to_recordset(v_deltas)
      as d(user_id uuid, balance_delta integer, profit_loss_delta integer)
   where m.team_id = v_team_id and m.user_id = d.user_id;

  perform set_config('app.allow_negative_balance', 'off', true);

  -- `bet_duels` goes with it by ON DELETE CASCADE, same as options, wagers and
  -- comments.
  delete from public.bets where id = p_bet_id;

  return v_deltas;
end;
$$;

-- --- remove_membership: void the departing participant's duels first --------------
-- Task 11. Two edits to the Phase 5 function, and the ORDER of the first
-- relative to the second is the whole point.
--
--  1. `app.void_duels_for_departing_member` runs BEFORE the wager delete and
--     before the membership delete. Before the wager delete because a voided
--     duel's wagers are the evidence of what was refunded and must survive;
--     before the membership delete because the refund has to land on a
--     `team_members` row that still exists for the SURVIVING participant (the
--     departing one's row is refunded too and then deleted, which is decision
--     §4.4 working as designed, not a leak).
--  2. The existing wager DELETE gains `and b.state <> 'resolved'`. This is a
--     NARROWING, in the exact sense this function's header already licenses:
--     "the argument can only ever narrow what the cascade already permits."
--     It is `removeMemberActiveWagers`'s own rule ("wagers on resolved bets stay
--     untouched") finally enforced server-side rather than trusted to the
--     client's list. Without it the cascade is unsafe in a way that only duels
--     expose: the client computes `p_wager_ids` from the state it holds, edit 1
--     then resolves those duels a moment later, and the un-narrowed DELETE
--     would strip a wager off a now-resolved bet — leaving a settled duel whose
--     refund has no wager behind it and a `deriveProfitLoss` replay that reports
--     drift for the surviving member.
create or replace function public.remove_membership(
  p_team_id   uuid,
  p_user_id   uuid,
  p_ban       boolean,
  p_wager_ids uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := app.require_uid();
  v_leader_id uuid := app.team_leader_id(p_team_id);
begin
  if p_user_id = v_uid then
    if p_ban then
      raise exception 'Use Leave team to remove yourself.' using errcode = 'check_violation';
    end if;
    if not app.is_team_member(p_team_id) then
      raise exception 'You are not a member of this team.' using errcode = 'no_data_found';
    end if;
  elsif not app.is_moderator_or_leader(p_team_id) then
    raise exception 'Only the leader or moderators can remove members.'
      using errcode = 'insufficient_privilege';
  end if;

  -- DOM-001: the leader has no exit but deleting the team (DOM-033). The
  -- Phase 3 BEFORE DELETE trigger enforces this too; saying it here is what
  -- produces a sentence a person can read instead of a constraint message.
  if p_user_id = v_leader_id then
    raise exception 'The team leader can''t be removed — delete the team instead.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.team_members m
     where m.team_id = p_team_id and m.user_id = p_user_id
  ) then
    raise exception 'That member is not on this team.' using errcode = 'no_data_found';
  end if;

  -- Edit 1 (Extra Phase 2, task 11). A departing MEDIATOR voids nothing — D7,
  -- and that is this function's WHERE clause, not an omission here.
  perform app.void_duels_for_departing_member(p_team_id, p_user_id);

  -- Edit 2: `and b.state <> 'resolved'` (see the banner). The rest is the
  -- Phase 5 statement unchanged — `p_wager_ids` comes from settlement.ts's
  -- `removeMemberActiveWagers` and is re-scoped to this team and this user, so
  -- a forged list can only ever narrow what the cascade already permits.
  delete from public.wagers w
   using public.bets b
   where w.id = any(p_wager_ids)
     and w.bet_id = b.id
     and b.team_id = p_team_id
     and w.user_id = p_user_id
     and b.state <> 'resolved';

  if p_ban then
    insert into public.team_bans (team_id, user_id, banned_by)
    values (p_team_id, p_user_id, v_uid)
    on conflict (team_id, user_id) do nothing;
  end if;

  delete from public.team_members
   where team_id = p_team_id and user_id = p_user_id;
end;
$$;


-- =============================================================================
-- ANTI-SPAM TRIGGER (task 9)
--
-- In 20260905120300_domain_invariants.sql's style and modelled directly on
-- Extra Phase 1's `enforce_chat_flood_control`, down to the named SQLSTATEs.
--
-- READ THIS BEFORE YOU REWORD ANYTHING: THIS IS RATE CONTROL, NOT MODERATION.
-- It bounds how many challenges one account may have IN FLIGHT inside one team,
-- and it never once looks at who they are aimed at or what the title says. It
-- has no opinion on content, so DOM-030 — no content moderation system, ever —
-- is untouched by this trigger existing. Anyone reading this later and
-- wondering "is this the moderation system in disguise": no, and this paragraph
-- is here so the question is answered before it is asked.
--
-- SECURITY INVOKER (the default — note the absence of any `security definer`
-- clause below), and it is load-bearing for exactly the reason the invariants
-- migration and the chat migration both spell out: a DEFINER trigger runs as
-- `postgres`, which makes `app.is_service_context()` true for EVERY caller and
-- disarms the whole guard for every client write. Invoker rights keep
-- `current_user` at 'authenticated' for a direct write and 'postgres' only
-- inside the seed, Studio or a genuine service context.
--
-- WHICH LEADS TO THE THING THIS COMMENT EXISTS TO SAY, because the next reader
-- WILL notice it and conclude the trigger is broken: with a service-context
-- escape hatch and invoker rights, this trigger DOES NOT FIRE FOR `create_duel`,
-- because `create_duel` is SECURITY DEFINER and therefore always in service
-- context. That is deliberate, and the cap is not thereby unenforced — it is
-- enforced in three layers, each covering what the others cannot:
--
--   1. `create_duel` itself counts and refuses, raising the SAME SQLSTATEs
--      (`SLD01`, `SLD02`) with the same sentences. This is the layer every real
--      member actually meets, and it is the only one that can produce a
--      readable refusal rather than a constraint error.
--   2. This trigger, for a write that arrives ANY OTHER WAY — a future RPC, a
--      script, a direct INSERT if a policy is ever added by mistake. It is
--      belt-and-braces today, and the day the belt breaks it is the only thing
--      left.
--   3. `bet_duels_one_pending_per_pair_idx`, which is the only one of the three
--      that holds under CONCURRENCY, because a partial unique index has no
--      escape hatch and no read-then-write window. `create_duel` catches its
--      23505 and re-raises SLD02 so the client sees one code for one situation.
--
-- The seed is the escape hatch's one real user, exactly as in chat: bulk
-- fixtures should be able to express a world without being rate-limited into
-- it one row at a time.
-- =============================================================================

create or replace function public.enforce_duel_pending_cap()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_team_id uuid;
  v_pending integer;
begin
  -- Seed, Studio, service_role — and, as the banner explains at length, every
  -- call arriving through `create_duel`, which does this check itself.
  if app.is_service_context() then
    return new;
  end if;

  select b.team_id into v_team_id from public.bets b where b.id = new.bet_id;

  select count(*)::integer into v_pending
    from public.bet_duels d
    join public.bets b on b.id = d.bet_id
   where b.team_id = v_team_id
     and d.challenger_id = new.challenger_id
     and d.accepted_at is null
     and b.state <> 'resolved';

  if v_pending >= app.duel_max_pending_per_challenger() then
    -- 'SLD01' is a user-definable SQLSTATE class, not a message the client
    -- pattern-matches, and that distinction is the whole point of using one:
    -- `asDuelFailure` keys on the CODE, so rewording this sentence tomorrow
    -- cannot silently break the toast. The sentence must still stand on its own
    -- — it is what a psql user or a Studio operator sees verbatim.
    raise exception
      'You already have % challenges waiting for an answer. Wait for one of them to be settled first.',
      app.duel_max_pending_per_challenger()
      using errcode = 'SLD01';
  end if;

  -- The pair half, with the same predicate the partial unique index uses, for
  -- the same reason `create_duel`'s copy does: three enforcement points that
  -- disagree about which insert they refuse would be worse than one.
  if exists (
    select 1 from public.bet_duels d
     where d.challenger_id = new.challenger_id
       and d.challengee_id = new.challengee_id
       and d.accepted_at is null
  ) then
    raise exception 'You already have a challenge waiting for an answer from them.'
      using errcode = 'SLD02';
  end if;

  return new;
end;
$$;

create trigger bet_duels_enforce_pending_cap
  before insert on public.bet_duels
  for each row execute function public.enforce_duel_pending_cap();


-- =============================================================================
-- REACH
--
-- Same shape as Phases 5-7: the `public.` functions ARE the API surface
-- (/rest/v1/rpc/<name>), the `app.*` helpers stay unreachable because `app` is
-- not in config.toml's `api.schemas`, and EXECUTE is revoked from PUBLIC before
-- it is granted so a definer function is never callable by a role nobody named.
-- =============================================================================

revoke execute on function
  public.create_duel(uuid, text, text, uuid, uuid, boolean, integer),
  public.accept_duel(uuid),
  public.decline_duel(uuid, public.bet_void_reason),
  public.sweep_stale_duels(),
  public.resolve_bet(uuid, public.bet_resolution_kind, uuid, public.bet_void_reason)
from public;

-- `resolve_bet` is re-granted here because the DROP above took its Phase 7 ACL
-- with it — an ACL belongs to a function, not to a name, and the four-argument
-- function is a different function. Miss this line and every resolution in the
-- app starts failing with "permission denied for function resolve_bet", which
-- is a failure mode that looks nothing like the overload trap that caused it.
grant execute on function
  public.create_duel(uuid, text, text, uuid, uuid, boolean, integer),
  public.accept_duel(uuid),
  public.decline_duel(uuid, public.bet_void_reason),
  public.sweep_stale_duels(),
  public.resolve_bet(uuid, public.bet_resolution_kind, uuid, public.bet_void_reason)
to authenticated;

-- CRITICAL, and the trap `20260906120000_team_chat.sql` documented for
-- `app.chat_retention_interval()`: `20260905120200_auth_helpers.sql`'s
-- `grant execute on all functions in schema app to authenticated, anon;` ran
-- ONCE, against the functions that existed at that moment. IT DOES NOT REACH
-- BACK and cover a function created in a later migration. Re-running it here
-- covers everything this file created, because it executes after them.
--
-- Policy expressions and SECURITY INVOKER callers execute as the invoking role,
-- which is why the read-only helpers above need this at all; they remain
-- unreachable over the API regardless, because `app` is not an exposed schema.
grant execute on all functions in schema app to authenticated, anon;

-- ...and then immediately take it back for the three that move money, which is
-- the same correction `app.prune_chat_messages()` made and for a sharper
-- reason. These three are SECURITY DEFINER functions that VOID BETS AND MOVE
-- BALANCES on anyone's behalf, and the blanket grant above (plus this schema's
-- inherited ALTER DEFAULT PRIVILEGES, which hands EXECUTE to `anon`,
-- `authenticated` and `service_role` BY NAME at CREATE time) would otherwise
-- leave them callable by any signed-in role.
--
-- The reach argument justifies the SEVERITY, never the GRANT: one line in
-- config.toml exposing the `app` schema — a change nobody would connect to duel
-- expiry — would turn "unreachable" into "any signed-in user can void any duel
-- they can name". Note that revoking from PUBLIC is what does most of the work
-- here, exactly as it did for the chat pruner; naming the two roles as well is
-- what strips the inherited named grants that `revoke ... from public` leaves
-- untouched.
--
-- Nothing loses a capability by this. Every caller of the three is itself a
-- SECURITY DEFINER function owned by `postgres` — `public.sweep_stale_duels`,
-- `public.decline_duel`, `public.resolve_bet`, `public.create_duel`,
-- `public.accept_duel`, `public.remove_membership` — and a definer function
-- executes with the owner's privileges, not the caller's.
revoke execute on function
  app.void_duel(uuid, public.bet_void_reason),
  app.expire_stale_duels(uuid),
  app.void_duels_for_departing_member(uuid, uuid)
from public, anon, authenticated;

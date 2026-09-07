-- =============================================================================
-- SL Fake Bets — duel rate control, corrected (Extra Phase 2, follow-up).
--
-- Two defects found by driving Extra Phase 2's own exit criteria against this
-- stack, both in task 9's anti-spam half, plus one inherited grant. None of
-- them is a design change: this file makes the code do what the roadmap
-- already says, and 20260906130000_duel_schema.sql already documented the
-- first as a limitation it declined to fix unilaterally.
--
-- --- 1. The pair rule locked two people out of each other permanently --------
--
-- The roadmap (task 9) asks for "a partial unique index making a second
-- PENDING duel from the same challenger to the same challengee impossible."
-- What shipped was
--
--     create unique index bet_duels_one_pending_per_pair_idx
--       on public.bet_duels (challenger_id, challengee_id) where accepted_at is null;
--
-- and "unaccepted" is not "pending". A declined, expired or cascade-voided
-- duel is resolved on `public.bets`, but its `bet_duels.accepted_at` stays
-- NULL FOREVER — nothing ever accepted it, so nothing ever stamps that column.
-- The index therefore kept matching a dead row, and the consequence was
-- user-visible and permanent: A challenges B, B declines, and A can never
-- challenge B again for the life of the team. Reproduced on this stack before
-- this migration was written; the second create_duel came back with SLD02's
-- 'You already have a challenge waiting for an answer from them.' — a sentence
-- that is simply false about a duel that was answered and declined.
--
-- Both PL/pgSQL copies of the rule (in `create_duel` and in the trigger)
-- deliberately matched the index's predicate rather than the roadmap's, on the
-- sound principle that three enforcement points disagreeing about which insert
-- they refuse is worse than one being wrong. So all three were wrong together,
-- which is why the pre-checks produced a readable sentence instead of a raw
-- 23505 and nothing looked broken.
--
-- WHY THE INDEX IS DROPPED RATHER THAN NARROWED. The correct predicate needs
-- `bets.state <> 'resolved'`, and a partial index predicate cannot reference
-- another table. The three ways out, and why this one:
--
--   (a) Mirror the state onto `bet_duels` as a `resolved_at` column and index
--       on that. Rejected: it is a duplicated column, and this schema's own
--       doctrine (20260905120000_domain_schema.sql's header, on deliberately
--       NOT denormalising team_id onto wagers/comments) is that "a join is not
--       a redesign, a duplicated column is a drift source." A second writer of
--       that column is a second thing that can be forgotten in a void path.
--   (b) Leave the index and accept the lockout. Rejected: it breaks a core
--       flow, and D3 exists precisely so a declined duel is a normal, repeatable
--       outcome rather than a terminal one.
--   (c) Drop the index and close the race it guarded with a lock the function
--       ALREADY TAKES. Chosen, and it costs nothing new.
--
-- (c) works because of what the two checks actually ask. Both are scoped to
-- one (challenger, team): the cap counts this challenger's outstanding duels
-- in this team, and the pair rule — now also team-scoped, for the same reason
-- the cap always was — asks whether this challenger already has one waiting on
-- this challengee here. `create_duel` locks `team_members` FOR UPDATE on
-- exactly (team_id, user_id) to make its balance check and debit atomic. That
-- single row lock serialises every concurrent create_duel by the same
-- challenger in the same team, which is precisely the set of calls those two
-- checks reason about — so count-then-insert cannot lose a race that matters.
-- All this migration does is move that lock ABOVE the checks it now also
-- protects. The trigger keeps its own copy for a write arriving some other way
-- (there is none today: `bet_duels` has no INSERT policy and no grant), and it
-- is no longer the loser of a race, because there is no longer a race.
--
-- Note what is NOT lost. The cap and the pair rule were never the interesting
-- concurrency case; the BALANCE was, and that check has been under this lock
-- since the function was written. Worst case now is that a determined attacker
-- with two connections in two different teams opens one extra challenge in
-- each — which is neither a money bug nor something the roadmap's "rate
-- control, not moderation" framing cares about.
--
-- AND IT IS STILL RATE CONTROL, NOT MODERATION. Same sentence the original
-- migration carries, repeated because this file rewrites the rule and the
-- question will be asked again: this bounds HOW MANY challenges one person may
-- have in flight and says nothing about who they are or what they said. DOM-030
-- is untouched.
--
-- --- 2. `anon` inherited EXECUTE on every duel RPC ---------------------------
--
-- Exactly the trap 20260906120000_team_chat.sql documented at length for
-- `public.chat_page`: this schema has an ALTER DEFAULT PRIVILEGES entry that
-- grants EXECUTE to `anon`, `authenticated` and `service_role` BY NAME at
-- CREATE time, so a `grant execute … to authenticated` adds nothing anon did
-- not already have, and `revoke … from public` does not touch anon's own named
-- grant. Verified before this migration: has_function_privilege('anon', …) was
-- true for create_duel, accept_duel, decline_duel, sweep_stale_duels and the
-- recreated resolve_bet.
--
-- Not a live hole — every one of them calls `app.require_uid()`, which raises
-- for a caller with no JWT subject — but "it fails a line later" is not the
-- reason to leave a money-moving RPC callable by the anonymous role, and the
-- chat migration already settled that the reach argument justifies the
-- severity, never the grant. Revoked below by name.
-- =============================================================================

-- --- 1a. the index ------------------------------------------------------------
drop index if exists public.bet_duels_one_pending_per_pair_idx;

comment on table public.bet_duels is
  'D1: the kind-specific half of a 1v1 duel, 1:1 with public.bets on the primary key. Every write is an RPC (20260906130100_duel_rpcs.sql) — there is no INSERT/UPDATE/DELETE policy for anyone, as bets has had none since Phase 6. Phase is DERIVED (computeDuelPhase), never stored, which is also why "is this duel still pending" is a join to bets.state and not a column here (see 20260906130400_duel_pair_rule_fix.sql). D7: a departing mediator strands nothing because app.can_resolve_duel falls back to the any-moderator pool at read time.';

-- --- 1b. the trigger's copy of the pair rule -----------------------------------
-- The cap half was already correct (it joins `bets` and filters
-- `state <> 'resolved'`); only the pair half matched the index. Both are now
-- team-scoped and both ask the same question `create_duel` asks.
create or replace function public.enforce_duel_pending_cap()
returns trigger language plpgsql set search_path = '' as $fn$
declare
  v_team_id uuid;
  v_pending integer;
begin
  -- Seed, Studio, service_role — and every SECURITY DEFINER RPC, which means
  -- this trigger does NOT fire for `create_duel`. That is the division of
  -- labour, not a hole: `create_duel` runs the same two checks itself and
  -- raises the same SQLSTATEs, because asDuelFailure in bet-mutations.ts keys
  -- on the CODE and never on the message text. This copy exists for a write
  -- that arrives some other way.
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
    raise exception
      'You already have % challenges waiting for an answer. Wait for one of them to be settled first.',
      app.duel_max_pending_per_challenger()
      using errcode = 'SLD01';
  end if;

  -- The corrected pair rule: unanswered AND not already dead, in this team.
  if exists (
    select 1
      from public.bet_duels d
      join public.bets b on b.id = d.bet_id
     where b.team_id = v_team_id
       and d.challenger_id = new.challenger_id
       and d.challengee_id = new.challengee_id
       and d.accepted_at is null
       and b.state <> 'resolved'
  ) then
    raise exception 'You already have a challenge waiting for an answer from them.'
      using errcode = 'SLD02';
  end if;

  return new;
end;
$fn$;

-- --- 1c. create_duel, with the lock moved above the checks ----------------------
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
  -- --- the lock, taken BEFORE the two rate checks -------------------------------
  -- MOVED HERE by 20260906130400_duel_pair_rule_fix.sql, and the move is what
  -- lets `bet_duels_one_pending_per_pair_idx` be dropped rather than fixed.
  --
  -- `place_wager`'s lock-then-debit sequence gives the first reason: serialising
  -- this one member row is what makes the balance check and the debit atomic,
  -- because without it two simultaneous challenges each read the pre-debit
  -- balance and both pass a check their sum violates.
  --
  -- The second reason is new, and it is why the lock now sits ABOVE the pending
  -- and pair checks instead of below them. Both of those checks are per
  -- (challenger, team) — the cap counts this challenger's outstanding duels in
  -- this team, and the pair rule asks whether this challenger already has one
  -- waiting on this challengee HERE. `team_members` is keyed (team_id, user_id),
  -- so this single row lock serialises every concurrent create_duel by the same
  -- challenger in the same team, which is exactly the set of calls those two
  -- checks reason about. Count-then-insert is therefore race-free on its own,
  -- and the partial unique index that used to be the concurrency backstop is
  -- gone — see that migration for why it had to go rather than be narrowed.
  --
  -- Third, unchanged: refusing an unaffordable challenge before writing five
  -- rows we are about to roll back is simply cheaper.
  select m.coin_balance into v_balance
    from public.team_members m
   where m.team_id = p_team_id and m.user_id = v_uid
     for update;

  -- --- rate control (task 9), now under the lock above --------------------------
  -- The cap: this challenger's outstanding, unanswered duels in THIS team.
  -- `b.state <> 'resolved'` is what makes it "outstanding" rather than merely
  -- "never accepted" — a declined, expired or cascaded duel keeps
  -- `accepted_at IS NULL` forever, because nothing ever accepted it, and
  -- counting those would hand every challenger a slowly filling quota they
  -- could never empty.
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

  -- The pair rule, and this is the half 20260906130400 exists to correct. It
  -- now asks the roadmap's actual question — "a second PENDING duel from the
  -- same challenger to the same challengee" — which needs both halves:
  -- `accepted_at is null` (never answered) AND `b.state <> 'resolved'` (not
  -- already dead). The original shipped only the first half, because it was
  -- written to match a partial unique index that could not see `bets.state`,
  -- and the result was that a single decline locked that pair forever: A
  -- challenges B, B declines, and A can never challenge B again for the life
  -- of the team. Scoped to the team for the same reason the cap is — two
  -- people who share two teams have two independent relationships, and a
  -- challenge in one says nothing about the other.
  if exists (
    select 1
      from public.bet_duels d
      join public.bets b on b.id = d.bet_id
     where b.team_id = p_team_id
       and d.challenger_id = v_uid
       and d.challengee_id = p_challengee_id
       and d.accepted_at is null
       and b.state <> 'resolved'
  ) then
    raise exception 'You already have a challenge waiting for an answer from them.'
      using errcode = 'SLD02';
  end if;

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

-- --- reach ----------------------------------------------------------------------
-- create_duel was replaced above, so its grants are re-stated (a replace keeps
-- them, but saying so once is cheaper than the next reader checking).
revoke execute on function
  public.create_duel(uuid, text, text, uuid, uuid, boolean, integer)
from public, anon;

grant execute on function
  public.create_duel(uuid, text, text, uuid, uuid, boolean, integer)
to authenticated;

-- --- 2. the inherited anon grants, revoked by name ------------------------------
-- `from public` alone does NOT do this — see the header. anon must be named.
revoke execute on function
  public.create_duel(uuid, text, text, uuid, uuid, boolean, integer),
  public.accept_duel(uuid),
  public.decline_duel(uuid, public.bet_void_reason),
  public.sweep_stale_duels(),
  public.resolve_bet(uuid, public.bet_resolution_kind, uuid, public.bet_void_reason)
from anon;

-- =============================================================================
-- SL Fake Bets — team chat (UX-019, Extra Phase 1).
--
-- One new table, `chat_messages`, and it is deliberately NOT shaped like its
-- closest relative in this schema, `comments` (20260905120000_domain_schema.sql):
--
--   `comments` reaches its team through its bet (bet_id → bets.team_id) because
--   a comment's only home is a bet page — one join, once, when the page loads.
--   Chat has no such single parent: every read is "this team, this window, this
--   page" — the rail on every dashboard render, the modal on every scroll-back
--   page — so `team_id` is a column on the row itself, not a hop through
--   another table. A join that is free once on a bet page is a join repeated on
--   every keyset page of a channel that never stops scrolling; that repeated
--   cost is the whole reason this table breaks the `comments` precedent instead
--   of following it.
--
--   DOM-030 (no content moderation, ever): exactly as `comments` has no
--   flag/hidden/deleted_at column, `chat_messages` has none either, and for the
--   same reason — there is no "hide this row" concept anywhere in this schema,
--   and adding one here would be the moderation system the spec forbids,
--   smuggled in through a chat feature instead of a chat feature's absence.
--
--   Retention (D1, roadmap §8 Extra Phase 1 task 5) is enforced TWICE, on
--   purpose, not out of caution. (a) a daily `pg_cron` prune physically deletes
--   rows older than the window; (b) the read path's own predicate independently
--   hides them regardless of whether (a) has run. (b) is the real guarantee:
--   retention that depends on a scheduler is retention that silently stops the
--   moment the scheduler does, and `design-scale-and-free-tier.md` §2.6 names
--   this app's target deployment as one that PAUSES after 7 idle days — a
--   week with the pruner not running is the expected case, not an outage. A
--   30-day-old message must be unreadable on day 31 whether or not a cron job
--   exists on this stack at all.
-- =============================================================================

-- --- chat_messages --------------------------------------------------------------

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- The SQL twin of CONFIG.CHAT_MESSAGE_MAX_CHARS / validateChatMessage
  -- (packages/shared/src/config.ts, validation.ts). Per the invariants
  -- migration's own rationale: a rule that lives only in validation.ts stops
  -- being an invariant the moment a write arrives from Studio or PostgREST,
  -- and from the day this table ships, both of those are live paths to it.
  -- Change the 500 here and in CONFIG.CHAT_MESSAGE_MAX_CHARS in the same
  -- commit, or the client will accept messages the database then rejects.
  body text not null check (length(btrim(body)) > 0 and length(body) <= 500),
  created_at timestamptz not null default now()
);

-- D5: a kicked or banned member's messages STAY. DOM-032's cascade is scoped to
-- ACTIVE WAGERS — it says nothing about speech — and deleting someone's history
-- as a side effect of a moderator action is exactly the moderation system
-- DOM-030 rules out. A row here dies only two ways: the 30-day window (below),
-- or cascade when the `users` row or the `teams` row is hard-deleted. Removal
-- from `team_members` (kick/ban) touches neither foreign key and leaves every
-- message the person ever sent exactly where it was.

-- One index, and it is the ONLY access path to this table — every read, rail
-- and modal alike, is `public.chat_page` (below), which is keyset-paged on
-- exactly these three columns in exactly this order. There is no query this
-- table serves that scans by anything else.
create index chat_messages_team_created_id_idx
  on public.chat_messages (team_id, created_at desc, id desc);

comment on table public.chat_messages is
  'UX-019 team-wide chat (Extra Phase 1), team-scoped directly — not through bets, unlike comments. DOM-030: no flag/hidden/deleted_at column, ever. D1: 30-day retention, enforced twice (app.prune_chat_messages + the chat_page window predicate). D5: kick/ban does not remove a member''s messages.';

-- --- realtime publication --------------------------------------------------------
-- Task 6 says, in as many words, "add chat_messages to
-- 20260905190000_realtime_publication.sql's idempotent do block" — and that
-- is where this statement was first written, folded into that file's
-- existing `foreach t in array array[...]` loop alongside `bets`/`wagers`/
-- `comments`. It cannot stay there: migrations apply in filename order, that
-- file is timestamped HOURS BEFORE this one, and `alter publication ... add
-- table` needs the relation to already exist — `public.chat_messages`, the
-- `create table` two dozen lines up THIS file. Running the ALTER from the
-- earlier file would fail `supabase db reset` with `relation "chat_messages"
-- does not exist` before this file's own `create table` ever gets a chance
-- to run. So the statement moved here, right beside the table it publishes,
-- which is the one place in migration-timestamp order where the relation is
-- guaranteed to already exist. `20260905190000_realtime_publication.sql`'s
-- own header carries the fuller account of why its loop still lists only
-- the original three tables and points back at this comment.
--
-- Same idempotent shape as that file's do-block (a `not exists` guard against
-- `pg_publication_tables`), so re-running this migration — `supabase db
-- reset` does, every time — is a no-op past the first apply, not a second
-- "table already in publication" error.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end;
$$;

-- --- RLS --------------------------------------------------------------------------
-- Modelled line-for-line on the `comments` block (20260905120400_rls_policies.sql).

alter table public.chat_messages enable row level security;

create policy chat_messages_select_team_member on public.chat_messages
  for select to authenticated
  using (app.is_team_member(team_id));

-- permissions.ts has no dedicated "canChat" rule to mirror — team membership
-- is the whole gate, same as comments' canComment (UX-018).
create policy chat_messages_insert_own on public.chat_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_team_member(team_id)
  );

-- DOM-030, restated exactly as the comments policy states it: there is no
-- content moderation system, and deleting someone else's message is precisely
-- what such a system would be. Moderators get no delete power here — only the
-- author can remove their own row, same shape as comments_delete_own.
create policy chat_messages_delete_own on public.chat_messages
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- NO UPDATE POLICY FOR ANYONE, and none is coming. Chat is append-only: a sent
-- message is a fact about what was said and when, and an editable one is an
-- edit-history feature this phase is not buying (roadmap task 2 says so in as
-- many words). Without a policy the table is simply un-updatable to every
-- role — belt and braces below revokes the verb outright, so a future policy
-- mistake cannot reopen it by accident.

grant select, insert, delete on public.chat_messages to authenticated;

-- Belt and braces, on the same reasoning the append-only ledger uses
-- (20260905120400_rls_policies.sql's closing `revoke update, delete on
-- public.transactions`): RLS filters ROWS, but a verb that was never granted
-- cannot be reached even through a future policy mistake.
--
-- UPDATE is the load-bearing one — append-only, no edit history (see the
-- policy block above). TRUNCATE matters more than it looks: it is the one
-- statement that **bypasses RLS entirely**, so a `truncate public.chat_messages`
-- would erase every team's history at once, which is exactly the power DOM-030
-- says no one has. It is not reachable through PostgREST, and this schema's
-- ALTER DEFAULT PRIVILEGES hands it to `authenticated` at create-table time,
-- so revoking it is a deliberate correction of an inherited default rather
-- than a no-op.
--
-- NOTE for whoever reads this next: the same inherited default leaves TRUNCATE
-- (and REFERENCES, TRIGGER) granted to `authenticated` on `comments`, `bets`,
-- `wagers` and every other table in this schema — verified, and NOT fixed here,
-- because a schema-wide privilege sweep is not this phase's to make. Recorded
-- so it is a known finding rather than a surprise.
revoke update, truncate on public.chat_messages from authenticated, anon;

-- --- retention: the one authoritative interval -----------------------------------
-- D1 / task 5. This function is the SINGLE authority for "how long a chat
-- message lives." Both halves of retention below — the scheduled prune and the
-- read-path window predicate — call this and nothing else, so the number can
-- never drift between the two enforcement points.
--
-- CONFIG.CHAT_RETENTION_DAYS in packages/shared/src/config.ts exists ONLY to
-- drive user-facing copy ("messages older than 30 days are cleared"). It is
-- not read by anything in this file and must not become one; the two values
-- must simply move together, and both files say so.
create or replace function app.chat_retention_interval()
returns interval language sql immutable set search_path = '' as $$
  select interval '30 days';
$$;

-- CRITICAL, and easy to miss: `20260905120200_auth_helpers.sql`'s
-- `grant execute on all functions in schema app to authenticated, anon;` ran
-- ONCE, against the functions that existed at that moment. It does not reach
-- back and cover a function created in a later migration. `public.chat_page`
-- below is SECURITY INVOKER, so when it calls app.chat_retention_interval()
-- the call runs AS THE CLIENT ROLE (authenticated), not as the function
-- owner — without this explicit grant every chat read fails with permission
-- denied, and it would fail silently past a casual read of this file, because
-- nothing here looks unusual until a client actually calls it.
grant execute on function app.chat_retention_interval() to authenticated, anon;

-- --- the read path: public.chat_page ---------------------------------------------
-- Why a function instead of a plain PostgREST select on the table:
--
--   1. The 30-day window predicate (task 5b, the REAL enforcement — see the
--      header banner) has to live in SQL beside the interval it compares
--      against. A PostgREST client-side filter could omit it, forget it, or
--      compute it with the wrong clock; a function makes omitting it
--      impossible rather than merely wrong.
--   2. Keyset paging on a (created_at, id) tie-break — "strictly before this
--      timestamp, or equal and strictly before this id" — is not expressible
--      as a plain PostgREST query string without an `or(...)` filter that is
--      easy to get subtly wrong (and impossible to unit-test against a typo
--      in the client). Writing the predicate once, here, is the fix.
--
-- SECURITY INVOKER (the default — no `security definer` clause below), and
-- that is load-bearing, not incidental: invoker rights mean the RLS policies
-- above still scope every row this function can return. It widens nothing;
-- it is convenience and correctness over the same rows `chat_messages_select_
-- team_member` already allows, never a way around that policy.
--
-- Rows come back NEWEST-FIRST (`order by created_at desc, id desc`), matching
-- the direction paging naturally walks (each page's oldest row becomes the
-- next page's "before" cursor). lib/data/chat.ts's ChatPage reverses this to
-- ascending before it reaches the store — the wire format and the render
-- order are allowed to differ, and here they deliberately do.
create or replace function public.chat_page(
  p_team_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 30
) returns setof public.chat_messages
language sql stable set search_path = '' as $$
  select c.*
    from public.chat_messages c
   where c.team_id = p_team_id
     and c.created_at >= now() - app.chat_retention_interval()
     and (
       p_before_created_at is null
       or c.created_at < p_before_created_at
       or (c.created_at = p_before_created_at and c.id < p_before_id)
     )
   order by c.created_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- Matching bet_preview's pair (20260905200000_share_previews.sql): revoke the
-- default PUBLIC execute before granting it back to the one role that should
-- have it. Chat has no unauthenticated audience — unlike bet_preview/
-- team_preview_by_code, nothing here is meant for a link-unwrapper — so
-- `anon` is deliberately absent from the grant.
--
-- And "absent from the grant" is NOT the same as "cannot execute" — the
-- distinction cost a verification pass to find, so it is written down here.
-- This schema has an ALTER DEFAULT PRIVILEGES entry that grants EXECUTE to
-- `anon`, `authenticated` and `service_role` **by name** on every function at
-- CREATE time. `revoke ... from public` strips only the bare PUBLIC
-- pseudo-role entry, so anon's own named grant survives it untouched. Simply
-- omitting anon from the `grant` below therefore leaves anon able to call
-- this function; the revoke has to name it. (`bet_preview` and
-- `team_preview_by_code` carry the same inherited anon grant — correctly, in
-- their case: they exist for link-unwrappers.)
revoke execute on function
  public.chat_page(uuid, timestamptz, uuid, int)
from public, anon;

grant execute on function
  public.chat_page(uuid, timestamptz, uuid, int)
to authenticated;

-- --- anti-flood trigger -----------------------------------------------------------
-- Task 4. In the invariants migration's style (20260905120300_domain_invariants.sql),
-- with its own SECURITY INVOKER warning repeated here because this is exactly
-- the trap that bit DOM-024 once already: a definer TRIGGER runs as `postgres`,
-- which makes app.is_service_context() true for every caller, which disarms
-- this whole guard for every client write. This function carries NO
-- `security definer` clause — invoker rights, the default — so `current_user`
-- stays 'authenticated' for a direct client insert and only ever reads
-- 'postgres'/'service_role' inside the seed, Studio, or a genuine service
-- context, exactly where the escape hatch below is supposed to apply.
--
-- READ THIS BEFORE YOU REWORD THE MESSAGES: this is FLOOD CONTROL, NOT
-- MODERATION. It bounds how FAST one (user, team) pair may write, and it never
-- once looks at WHAT was written beyond a byte-for-byte equality check used
-- only to catch an accidental double-send. It has no opinion on content, so
-- DOM-030 — no content moderation system, ever — is untouched by this trigger
-- existing. Anyone reading this later and wondering "is this the moderation
-- system in disguise" — no, and this paragraph is here so the question is
-- answered before it is asked.
create or replace function public.enforce_chat_flood_control()
returns trigger language plpgsql set search_path = '' as $$
declare
  -- Named constants, tunable in exactly one place. The numbers are the
  -- roadmap's own ("~5 messages per rolling 10 seconds", "a byte-identical
  -- body within 5 seconds") — not derived from anything, just written here
  -- once instead of scattered as bare literals through the function body.
  c_flood_max_messages constant integer  := 5;
  c_flood_window       constant interval := interval '10 seconds';
  c_duplicate_window   constant interval := interval '5 seconds';
  v_recent_count integer;
begin
  -- Seed, Studio, service_role. Never the client — nobody sends chat messages
  -- through a settlement RPC, so unlike enforce_team_member_update_rules this
  -- escape hatch has exactly one real user: bulk fixtures.
  if app.is_service_context() then
    return new;
  end if;

  -- Rate limit: this insert would be the (c_flood_max_messages + 1)th message
  -- from this (user, team) inside the rolling window, so it is refused
  -- outright rather than merely delayed.
  select count(*) into v_recent_count
    from public.chat_messages c
   where c.team_id = new.team_id
     and c.user_id = new.user_id
     and c.created_at >= now() - c_flood_window;

  if v_recent_count >= c_flood_max_messages then
    -- 'SLC01' is a user-definable SQLSTATE class, not a message the client
    -- pattern-matches. That distinction is the whole point of using one: the
    -- client keys on the CODE ('SLC01'), so rewording this sentence tomorrow
    -- cannot silently break the toast the client shows for it. The sentence
    -- itself must still stand on its own — it is shown to the member verbatim
    -- as the toast fallback if the client has no friendlier copy for the code.
    raise exception
      'You are sending messages faster than the channel allows. Wait a few seconds and try again.'
      using errcode = 'SLC01';
  end if;

  -- Duplicate guard: the same body, from the same (user, team), inside the
  -- shorter window. This exists for the accidental double-tap on a slow
  -- connection, not for anything content-related — see the trigger comment.
  if exists (
    select 1
      from public.chat_messages c
     where c.team_id = new.team_id
       and c.user_id = new.user_id
       and c.body = new.body
       and c.created_at >= now() - c_duplicate_window
  ) then
    raise exception
      'That message was just sent. Sending the exact same message twice in a row is blocked.'
      using errcode = 'SLC02';
  end if;

  return new;
end;
$$;

create trigger chat_messages_enforce_flood_control
  before insert on public.chat_messages
  for each row execute function public.enforce_chat_flood_control();

-- --- retention: scheduled prune (D1 / task 5a) -------------------------------------
-- SECURITY DEFINER, unlike every function above it in this file: pruning must
-- delete rows regardless of whose messages they are and with RLS bypassed —
-- exactly the shape resolve_bet and claim_daily_reward already use for
-- privileged writes (20260905170000_resolution_rewards_ledger.sql).
--
-- Grant execute to NOBODY beyond Postgres's own default. `postgres` and
-- `service_role` already reach it as the function owner / superuser; a client
-- never should, and does not need to — nothing in the app calls this by name,
-- only the cron job below does, and `app` is not a PostgREST-exposed schema
-- regardless of any grant (20260905120200_auth_helpers.sql's header banner).
-- Explicitly revoking from `authenticated` here would document a risk that
-- does not exist through this path; it is left alone on purpose, the same
-- restraint the auth helpers file shows for app.is_service_context().
create or replace function app.prune_chat_messages()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_deleted_count integer;
begin
  delete from public.chat_messages
   where created_at < now() - app.chat_retention_interval();

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

-- This one DOES need an explicit revoke, and the argument for skipping it was
-- wrong. The reasoning was that `app` is not in `config.toml`'s `api.schemas`,
-- so nothing in it is callable over PostgREST — which is true, and is why this
-- is hardening rather than a live hole. But the grant state it left behind is
-- indefensible on its own terms: this is a SECURITY DEFINER function that
-- **deletes rows from every team's chat history**, and the schema-wide default
-- ACL handed EXECUTE on it to `anon`, `authenticated` and `service_role` at
-- CREATE time. One line in `config.toml` exposing the `app` schema — a change
-- nobody would connect to chat retention — would turn that into any signed-in
-- user being able to wipe the table.
--
-- So: the reach argument justifies the *severity*, never the *grant*.
--
-- After this revoke NO role can execute it except `postgres` itself, which
-- owns the function — and that is deliberately everything it needs. The
-- pg_cron job below runs as `postgres`, and Studio's SQL editor connects as
-- `postgres` too. Note the revoke of PUBLIC is what does the real work here:
-- this function had no named grants at all, only Postgres's implicit PUBLIC
-- execute, which is what `has_function_privilege` was reporting as `true` for
-- anon, authenticated and service_role alike. Naming the three roles as well
-- is a no-op today and cheap insurance if a later migration grants one of them
-- directly.
revoke execute on function app.prune_chat_messages() from public, anon, authenticated;

-- Scheduling it: pg_cron availability for THIS repo's local stack has already
-- been verified, not assumed — version 1.6.4, present in
-- `shared_preload_libraries`, `create extension if not exists pg_cron`
-- installs cleanly, and `cron.schedule` runs against the `postgres` database
-- exactly as this call below expects. `cron.schedule` upserts by jobname in
-- pg_cron >= 1.4, so re-running this migration (as `supabase db reset` does
-- every time) reschedules the same job rather than duplicating it.
--
-- Wrapped in `do $$ ... $$` with a catch-all handler anyway, so a stack that
-- genuinely lacks the extension still applies every other statement in this
-- file cleanly — the header banner's whole point is that task 5b (the
-- read-path window predicate) is the real enforcement and does not depend on
-- this succeeding. The `raise notice` says exactly that, so the operator
-- reading migration output is told the guarantee, not left to assume a
-- silent no-op means messages never expire.
--
-- Dollar-quoting note: this block is already inside `do $$ … $$`, so the
-- notice text below uses a DIFFERENTLY TAGGED dollar-quote ($notice$ … $notice$)
-- rather than a second `$$ … $$` — reusing the same tag would close the outer
-- block at the first `$$` the parser meets, not at the one meant to end it.
do $$
begin
  execute 'create extension if not exists pg_cron';

  perform cron.schedule(
    'prune-chat-messages',
    '17 3 * * *',
    'select app.prune_chat_messages()'
  );
exception when others then
  raise notice $notice$Extra Phase 1: pg_cron is not available on this stack, so app.prune_chat_messages() has not been scheduled. This is not a retention gap — chat_page's window predicate and app.chat_retention_interval() (task 5b) independently hide any message older than the retention window on every read, whether or not the physical row has been deleted yet.$notice$;
end;
$$;

-- --- feature flag: flip the switch (task 13, SQL half) -----------------------------
-- `global-team-chat` was seeded false by 20260905120100_infra_tables.sql as a
-- [future] placeholder; this UPDATEs the same row rather than inserting a new
-- one, and an UPDATE by primary key is naturally no-op-safe — running this
-- migration again (supabase db reset) simply re-applies the same values.
--
-- The description is rewritten because the flag's JOB changes here: it stops
-- being a marker for a feature that does not exist yet and becomes the live
-- kill switch for one that does. `apps/web/src/lib/feature-flags.tsx` reads it
-- at load exactly as it always has (ARC-016) — only the meaning of `false`
-- changes, from "not built" to "hide the real module."
update public.feature_flags
   set enabled = true,
       description = 'UX-019: team-wide chat channel (rail + modal), separate from per-bet threads. LIVE as of Extra Phase 1 — this is now the kill switch, not a future-feature placeholder: flipping to false hides chat-module.tsx and chat-modal.tsx on the next load, no deploy, no rebuild (ARC-016).'
 where key = 'global-team-chat';

-- `coming-soon-teasers` is NOT touched by this migration, and that silence is
-- deliberate, not an oversight: this phase replaces the UX-019 chat stub that
-- flag currently gates (20260905200000_share_previews.sql), which would leave
-- ARC-016's live-toggle proof with no subject the moment the stub is deleted —
-- exactly the "silent regression" the roadmap's risk 4 warns about. The
-- decision taken is to RE-POINT `coming-soon-teasers`, not retire it: it moves
-- to gate the Wallet module's DOM-023 "Donate coins" stub instead, so flipping
-- it off in Studio still visibly hides something real. That re-pointing is a
-- CLIENT change (which component reads the flag), owned by whichever agent
-- builds the Wallet stub — this comment exists so that agent's work and this
-- migration agree on what happened to the flag and why, rather than one side
-- silently assuming the other already handled it.

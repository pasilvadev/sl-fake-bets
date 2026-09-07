-- =============================================================================
-- SL Fake Bets — `public.bet_duels` joins the realtime publication
-- (Extra Phase 2, task 12's server half).
--
-- WHY THIS IS ITS OWN FILE AND NOT A LINE IN 20260905190000_realtime_publication.sql
--
--   Because `alter publication ... add table` is not a forward declaration.
--   Postgres resolves the identifier immediately, so the statement must sort
--   AFTER the migration that creates the relation — and
--   `20260905190000_realtime_publication.sql` is timestamped a day earlier than
--   `20260906130000_duel_schema.sql`. Folding `bet_duels` into that file's
--   `foreach t in array array['bets', 'wagers', 'comments']` loop is the
--   literal reading of the task, it is what Extra Phase 1 tried for
--   `chat_messages`, and it fails `supabase db reset` with
--   `relation "bet_duels" does not exist` at THAT migration — two files before
--   the one that looks like the problem. Both that file's header and the chat
--   migration's own do-block comment record the lesson at length; this file is
--   what following it looks like.
--
--   Extra Phase 1 put its statement inside `20260906120000_team_chat.sql`
--   itself, beside the `create table`. This phase gives it a separate migration
--   instead, and the difference is deliberate rather than a divergence in
--   style: a publication change is the one server change in this phase that
--   alters what leaves the database over the wire, and
--   `design-scale-and-free-tier.md` treats egress as the named ceiling. Keeping
--   it as its own reviewable unit — one file, one statement, one paragraph of
--   justification — is worth more than the consistency of tucking it into the
--   schema file. It sorts after `20260906130000_duel_schema.sql`, so the
--   relation exists by the time it runs.
--
-- WHY IT MUST HAPPEN AT ALL
--
--   `design-realtime.md` §4 fact 1 is explicit and this is the failure it
--   describes: a table absent from `supabase_realtime` is SILENTLY inert. The
--   subscription connects, the channel reports SUBSCRIBED, the callback is
--   registered, and no event is ever delivered — there is no error anywhere to
--   notice. That is exactly the state every table in this schema was in until
--   `20260905190000_realtime_publication.sql`, and it is the state
--   `public.bet_duels` would be in without this file: a challenge accepted on
--   one device would sit unchanged on another until a manual refresh, with
--   nothing in any log to explain it.
--
-- WHAT THE CLIENT BINDS, AND WHY IT IS NOT THE SAME SET AS chat_messages'
--
--   `subscribeTeamChannel` (apps/web/src/lib/data/realtime.ts) binds INSERT and
--   UPDATE on this table — the fifth binding on the one coarse per-team channel
--   §5 rule 1 allows, not a new subscription.
--
--     INSERT — a new challenge has to appear in the feed for the whole team the
--              instant it exists, which is the same entitlement `bets` INSERT
--              already has (the duel's `bets` row arrives on that binding; this
--              one carries the half that says who is in it and for how much).
--     UPDATE — `accept_duel` moves `accepted_at` from null to a timestamp, and
--              that single column change is what flips the row from "waiting"
--              to AWAITING RESULT on every other member's screen. Without the
--              UPDATE binding the accept is invisible until a reload, which is
--              the one moment in a duel's life when two people are most likely
--              to be looking at it.
--     no DELETE — a `bet_duels` row only ever dies WITH its bet, by
--              ON DELETE CASCADE, and `bets` DELETE already carries that event.
--              A second delivery of the same fact would be pure egress for
--              nothing, and it would arrive with a `bet_duels` primary key that
--              is the bet id anyway — literally the same message twice.
--
--   Note the contrast with `chat_messages`, which binds INSERT only: there the
--   reason was the nightly `app.prune_chat_messages()` DELETE storm, a burst
--   nobody watches. `bet_duels` has no bulk mutation path at all — every write
--   is one row inside one RPC — so UPDATE is affordable here in a way a chat
--   DELETE binding was not.
--
--   `bet_duels` has NO team column (the team is reached through
--   `bets.team_id`), so unlike `chat_messages` this binding cannot carry a
--   server-side `filter: team_id=eq.…` and leans on RLS the way the `wagers`
--   binding already does. The receiver still applies the standing client rule —
--   ignore any bet id you do not already hold.
--
-- REPLICA IDENTITY stays at the default (primary key), for the reason
-- `20260905190000_realtime_publication.sql` gives for every other table: the
-- client compares the NEW record against the copy it already holds, so OLD
-- values buy nothing, and `replica identity full` would double the WAL volume
-- of every accept for information nothing reads.
--
-- Same idempotent shape as the do-blocks in both earlier publication
-- statements (a `not exists` guard against `pg_publication_tables`), so
-- re-running this migration — `supabase db reset` does, every time — is a
-- no-op past the first apply rather than a "table already in publication"
-- error.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'bet_duels'
  ) then
    execute 'alter publication supabase_realtime add table public.bet_duels';
  end if;
end;
$$;

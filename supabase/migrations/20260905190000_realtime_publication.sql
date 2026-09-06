-- =============================================================================
-- Realtime publication — roadmap Phase 8, task 0.
--
-- `config.toml` starts the Realtime service, but Postgres Changes delivers
-- nothing until the tables are in the `supabase_realtime` publication. Until
-- this migration, they were not: subscriptions connected, reported SUBSCRIBED,
-- and never fired. This is the whole server side of Phase 8.
--
-- WHAT IS IN, AND WHY ONLY THESE FOUR
--
--   bets, wagers, comments, chat_messages — the four tables whose changes
--   another member is entitled to see the instant they happen (ARC-005 /
--   UX-013 / UX-018 / UX-019): a new bet in the feed, a pool multiplier
--   moving under someone else's wager, a new comment in a thread, a new
--   message in the team's chat channel. `chat_messages` joined this list in
--   Extra Phase 1 (20260906120000_team_chat.sql): a team channel is exactly
--   the kind of team-wide, always-mounted surface this publication exists
--   for, and it reuses the SAME per-team channel `subscribeTeamChannel`
--   already opens — no new subscription, one more binding on the one this
--   file already justifies.
--
--   On the client, `chat_messages` binds INSERT only — the same restraint
--   `subscribeTeamChannel` already applies to `wagers`, and for a sharper
--   reason in chat's case: the daily `app.prune_chat_messages()` job (task 5a)
--   is a DELETE storm by design, capable of removing weeks of rows in one
--   statement, and every one of those rows is still IN this publication (a
--   published table replicates every DML unless told otherwise). Binding only
--   the INSERT event on the channel is what stops that burst from ever
--   reaching a subscriber — nobody is watching a 31-day-old message disappear
--   in real time, so there is no "ignore dead ids" rule to write for chat the
--   way there is for `bets` DELETE below; there is simply no DELETE event
--   delivered to bind a rule to. Egress for a burst nobody would use is
--   exactly the cost `design-scale-and-free-tier.md` §2.2/§4.1 name as the
--   ceiling to watch, and this is how chat avoids paying it.
--
--   `chat_messages` itself is added to the publication by a DIFFERENT do-block
--   than the one below — see "WHY THIS FILE, NOT A SECOND MIGRATION" further
--   down for exactly where and why. It is described here, in this file's own
--   "what is in" inventory, because that inventory is about what the
--   publication CONTAINS, not about which migration's DDL put it there.
--
-- WHAT IS DELIBERATELY OUT (agent-docs/design-realtime.md §5 rule 3)
--
--   team_members — one `resolve_bet` rewrites ~30 balance rows in a single
--   transaction. At 15 online members that is 450 delivered messages from ONE
--   resolution, more than a normal day of bets, wagers and comments combined.
--   It is also where the double-apply race bites: `resolve_bet` and
--   `delete_bet` already return the deltas they applied and the acting client
--   already dispatches them, so replaying the balance UPDATEs would move the
--   same money twice. Clients derive remote balance moves from the bet's own
--   resolution/deletion event instead.
--
--   transactions — the ledger. Append-only, unbounded, and read by exactly one
--   modal; nothing on screen goes stale without it.
--
-- REPLICA IDENTITY: left at the default (primary key) on purpose.
--
--   `replica identity full` would be needed only if the client had to read the
--   OLD values of an UPDATE or the full row of a DELETE. It does not:
--     * UPDATE — the client compares the NEW record against the copy it already
--       holds (open→closed, →resolved), so old values add nothing.
--     * DELETE — the payload carries the primary key, and the id is the whole
--       message: the client looks the bet up in its own state and unwinds it
--       there (`reverseBet`), or ignores the id entirely.
--   Setting it to full would double the WAL volume of every wager and comment
--   for information nothing reads.
--
-- SECURITY NOTE, recorded here because the mitigation is NOT in this file:
--   RLS is not applied to DELETE events — Postgres cannot evaluate a policy
--   against a row that no longer exists — so a `delete_bet` reaches every
--   subscriber regardless of team. The bet id is all that leaks, and the
--   client-side rule that contains it is "ignore any id you do not already
--   hold" (lib/data/realtime.ts). Do not add a table here whose bare primary
--   key would itself be sensitive.
--
-- WHY THIS FILE, NOT A SECOND MIGRATION — true for `bets`/`wagers`/`comments`,
-- FALSE for `chat_messages`, and that split is the point of this paragraph.
-- This whole stack is local-only so far (hosted anything, ARC-012, is the one
-- `[mvp]` item the README lists as still not built) — there is no
-- already-deployed history anywhere that this migration's past runs are
-- locked against, only `supabase db reset` replaying every migration in order
-- against a brand-new database each time. Editing this file in place would
-- therefore be the right move for any table that already exists BEFORE this
-- migration runs, exactly the case for the original three.
--
-- `chat_messages` is not that case, and adding it to the loop below the way
-- the other three are listed was tried and is WRONG, on purpose left
-- unrepeated here as a warning to the next agent tempted to "just add the
-- name to the array" the way task 6 of Extra Phase 1 reads literally.
-- Migrations apply in filename order, and this file is timestamped
-- `20260905190000` — hours BEFORE `20260906120000_team_chat.sql`, the
-- migration whose `create table public.chat_messages` brings the relation
-- into existence in the first place. `alter publication ... add table` is
-- not a forward declaration; Postgres resolves the identifier immediately
-- and raises `relation "chat_messages" does not exist` the moment this
-- do-block would try it, failing `supabase db reset` at THIS migration, two
-- files before the one that was supposed to be the problem. So the actual
-- `alter publication supabase_realtime add table public.chat_messages`
-- statement lives in `20260906120000_team_chat.sql` itself, in its own
-- idempotent do-block right beside the table it publishes, where the
-- ordering is no longer a hazard — see that file's own comment for the
-- statement. The `not exists` guard below still covers only the three
-- tables that were genuinely safe to fold into one in-place edit.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['bets', 'wagers', 'comments'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- Realtime publication — roadmap Phase 8, task 0.
--
-- `config.toml` starts the Realtime service, but Postgres Changes delivers
-- nothing until the tables are in the `supabase_realtime` publication. Until
-- this migration, they were not: subscriptions connected, reported SUBSCRIBED,
-- and never fired. This is the whole server side of Phase 8.
--
-- WHAT IS IN, AND WHY ONLY THESE THREE
--
--   bets, wagers, comments — the three tables whose changes another member is
--   entitled to see the instant they happen (ARC-005 / UX-013 / UX-018): a new
--   bet in the feed, a pool multiplier moving under someone else's wager, a
--   new comment in a thread.
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

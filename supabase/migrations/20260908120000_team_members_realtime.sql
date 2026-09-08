-- =============================================================================
-- SL Fake Bets — `public.team_members` joins the realtime publication
-- (post-launch bug fix, amending design-realtime.md §5 rule 3).
--
-- THE BUG THIS FIXES
--
--   `team_members` was never in `supabase_realtime` at all — §5 rule 3 said
--   "do not subscribe to team_members," and the table simply was not
--   published, full stop. The consequence: when someone joined a team while
--   an existing member had that team's dashboard open, nothing told that
--   dashboard a new row existed anywhere. The new member did not appear in
--   the roster, the standings module, or anywhere else a teammate is named,
--   until a manual refresh ran `loadTeamData` again. Worse for a BRAND-NEW
--   account (one no team this client belongs to had ever put in its `users`
--   array): if that account placed a bet or a wager before anyone refreshed,
--   it rendered with no name where its creator or bettor belongs, because
--   `userById` had nothing to find. Both symptoms were the same missing fact
--   reaching zero subscribers.
--
-- WHY AN INSERT-ONLY EXCEPTION DOES NOT REOPEN §5 RULE 3's ACTUAL CONCERN
--
--   The rule's reasoning (still correct, still in force) was never about
--   membership rows existing — it was about `resolve_bet` rewriting ~30
--   balance rows in one transaction: 30 changes × 15 subscribers = 450
--   delivered messages from a single resolution, more than a normal day of
--   bets, wagers and comments combined, and the exact double-apply race
--   `20260905190000_realtime_publication.sql`'s header records (a resolution
--   already returns its deltas to the acting client, which already dispatches
--   them — replaying the UPDATEs would move the same money twice).
--
--   That is a statement about UPDATE. A join is a single row, written once by
--   `app.seed_membership` for the entire lifetime of a membership — there is
--   no bulk write path here to flood anything, which is the asymmetry that
--   makes an INSERT exception safe where a blanket subscription would not be.
--   `apps/web/src/lib/data/realtime.ts`'s `subscribeTeamChannel` binds ONLY
--   `event: "INSERT"` on this table, the same restraint already established
--   for `chat_messages` (bound for INSERT, never for the nightly retention
--   prune's DELETE storm) — publishing the table and then binding narrowly is
--   the pattern this file follows, not a new one.
--
--   UPDATE (balance changes) and DELETE (the kick/ban cascade) stay exactly as
--   unsubscribed as they were: balances still move on this client purely by
--   recomputing the deltas a bet's own resolution/deletion event carries
--   (`team-context.tsx`'s `applyRemote`), and a departure still resolves on
--   the next load, same as before this migration.
--
-- REPLICA IDENTITY stays at the default (primary key), for the same reason
-- every other table in this publication does: the client reads the INSERT
-- payload's own columns and needs no OLD row and no DELETE payload from this
-- table at all. `replica identity full` would double the WAL volume of every
-- balance-changing UPDATE this table ever takes, for information an
-- INSERT-only binding never reads.
--
-- Same idempotent shape as every do-block before it (a `not exists` guard
-- against `pg_publication_tables`), so re-running this migration —
-- `supabase db reset` does, every time — is a no-op past the first apply
-- rather than a "table already in publication" error.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'team_members'
  ) then
    execute 'alter publication supabase_realtime add table public.team_members';
  end if;
end;
$$;

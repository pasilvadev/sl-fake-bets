-- =============================================================================
-- Bound analytics_events.properties — plan-hosted-early-access.md §2.5/§7,
-- Phase 1 task 9.
--
-- `analytics_events` accepts anonymous INSERTs by design (ARC-017's
-- invite→signup half starts before an account exists — 20260905120100_infra_tables.sql's
-- own header explains why), which makes it the one write path in this schema
-- with no membership or ownership check standing between a stranger on a
-- public URL and a row. Ranked in the hosted plan's abuse-surface review as
-- "low × low": low incentive (there is nothing here to steal or grief) and
-- low blast radius (one extra row), but "nobody would bother" is not the same
-- claim as "the column has a bound", and this schema does not otherwise leave
-- an unbounded jsonb blob writable by `anon`.
--
-- The app itself only ever writes a step name or a short code
-- (`ANALYTICS_EVENTS` in packages/shared/src/infra.ts names the only two
-- event types that exist), so 4096 bytes is not a real ceiling being brushed
-- against — it is a ceiling on what an INSERT crafted outside the app could
-- do, which is exactly the case this CHECK is for.
-- =============================================================================

alter table public.analytics_events
  add constraint analytics_events_properties_size
  check (pg_column_size(properties) <= 4096);

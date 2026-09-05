-- =============================================================================
-- Infra tables: analytics (ARC-017) and feature flags (ARC-016).
--
-- These have no types.ts counterpart — they are not domain objects. Shapes come
-- from design-stack.md §3, which chose in-house tables over PostHog to keep the
-- vendor count at two (ARC-001/ARC-003).
-- =============================================================================

-- --- analytics_events ---------------------------------------------------------
-- ARC-017 caps observability at exactly two metrics: onboarding per-step
-- drop-off (UX-028) and invite→signup conversion. Both are plain SQL over this
-- table. Build nothing broader — no dashboard (design-stack §3 is explicit).

create table public.analytics_events (
  -- bigint identity, not uuid: this is the one append-heavy table, and it is
  -- never referenced by a foreign key.
  id bigint generated always as identity primary key,
  event_name text not null check (length(btrim(event_name)) > 0),
  -- The invite→signup funnel starts BEFORE an account exists, so the anonymous
  -- id is what stitches pre- and post-signup events together. Exactly one of
  -- the two identifiers is enough; requiring a user_id would make the first
  -- half of the mandated metric unmeasurable.
  anonymous_id text,
  user_id uuid references public.users (id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint analytics_events_has_identity check (
    user_id is not null or anonymous_id is not null
  )
);

create index analytics_events_name_created_at_idx
  on public.analytics_events (event_name, created_at);
create index analytics_events_anonymous_id_idx
  on public.analytics_events (anonymous_id)
  where anonymous_id is not null;

comment on table public.analytics_events is
  'ARC-017: feeds exactly two metrics (onboarding funnel, invite→signup). Insert-only from the app; read via Studio SQL.';

-- --- feature_flags ------------------------------------------------------------
-- ARC-016: post-MVP features toggle without a deploy or rebuild. Flipping a row
-- in Studio is the whole mechanism. No per-user targeting, no percentage
-- rollouts — design-stack §3 rules those out until a feature actually needs one.

create table public.feature_flags (
  key text primary key check (length(btrim(key)) > 0),
  enabled boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

comment on table public.feature_flags is
  'ARC-016. Read by the app at load; written only in Studio (service_role). RLS grants read to everyone, writes to no one.';

-- Seed the flags for the features the spec already names as post-MVP/future, so
-- toggling one is a Studio click rather than a migration.
insert into public.feature_flags (key, enabled, description) values
  ('coin-donation',     false, 'DOM-023 [post-mvp]: user-to-user coin donation.'),
  ('global-team-chat',  false, 'UX-019 [future]: team-wide chat channel, separate from per-bet threads.'),
  ('crowd-resolution',  false, 'DOM-020 [future]: auto-resolve when N members report the same winner.'),
  ('platform-icon-set', false, 'DOM-010 [future]: platform icon set alongside emoji bet icons.'),
  ('locale-pt-br',      false, 'UX-027 [future]: pt-BR localization. UI is English-only at launch (UX-026).');

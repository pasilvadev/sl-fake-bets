-- =============================================================================
-- ARC-017: the two metrics. All of them. Run in Supabase Studio's SQL editor.
--
-- These queries ARE the analytics product (design-stack.md §3): there is no
-- dashboard, no vendor, and no third metric. `analytics_events` has no SELECT
-- policy for anon or authenticated — reading is a service_role/Studio action —
-- so nothing in the app can grow a reporting surface without a schema change
-- that someone has to write on purpose.
--
-- Event names come from `ANALYTICS_EVENTS` in packages/shared/src/infra.ts.
-- If you rename one there, rename it here; the constant exists so that stays a
-- two-file edit rather than a silent zero.
--
-- **Every count is DISTINCT over the actor**, never a row count. The writer is
-- fire-and-forget with an in-session guard only (apps/web/src/lib/analytics.ts),
-- so reloads and second tabs produce duplicate rows by design. Counting rows
-- would report traffic; counting actors reports people, which is what a funnel
-- is for.
-- =============================================================================


-- --- Metric 1: onboarding per-step drop-off (UX-028) ---------------------------
--
-- The four steps are signup → team → profile → dashboard (decision §4.7), and
-- the actor is the account where there is one, the anonymous id where there is
-- not: the `signup` step happens on the auth screen, before any account exists,
-- so an account-only count would show 100% drop-off into a step everybody
-- reaches. `coalesce` is what keeps the first step comparable to the rest.

with reached as (
  select
    properties ->> 'step'                          as step,
    coalesce(user_id::text, anonymous_id)          as actor
  from public.analytics_events
  where event_name = 'onboarding_step'
    and created_at >= now() - interval '30 days'
),
counted as (
  select step, count(distinct actor) as actors
  from reached
  group by step
),
ordered as (
  select
    s.step,
    s.position,
    coalesce(c.actors, 0) as actors
  from unnest(array['signup', 'team', 'profile', 'dashboard'])
       with ordinality as s(step, position)
  left join counted c on c.step = s.step
)
select
  position,
  step,
  actors,
  lag(actors) over (order by position) - actors            as dropped_from_previous,
  round(
    100.0 * actors / nullif(first_value(actors) over (order by position), 0), 1
  )                                                        as pct_of_step_1
from ordered
order by position;


-- --- Metric 2: invite-open → signup conversion ---------------------------------
--
-- The anonymous id is the join key and the only thing that could be: the open
-- happens before an account exists and the signup after, so a user_id join
-- would have nothing to match on the near side. Both events are written under
-- the id that `getAnonymousId()` persisted on the first page view.
--
-- `signup_completed` fires while `users.onboarded_at` is still NULL — the
-- account's first run — so "converted" means an invite this browser opened
-- became a new account, not merely that someone signed in afterwards.

with opened as (
  select distinct anonymous_id
  from public.analytics_events
  where event_name = 'invite_opened'
    and anonymous_id is not null
    and created_at >= now() - interval '30 days'
),
signed_up as (
  select distinct anonymous_id
  from public.analytics_events
  where event_name = 'signup_completed'
    and anonymous_id is not null
)
select
  (select count(*) from opened)                                   as invites_opened,
  (select count(*) from opened join signed_up using (anonymous_id)) as became_accounts,
  round(
    100.0 * (select count(*) from opened join signed_up using (anonymous_id))
      / nullif((select count(*) from opened), 0), 1
  )                                                               as conversion_pct;


-- --- Same metric, per team ------------------------------------------------------
-- Which invite links actually work. Still two metrics, not three: this is
-- metric 2 grouped by the team whose code was opened, which the `properties`
-- already carry.

with opened as (
  select distinct
    (properties ->> 'team_id')::uuid as team_id,
    anonymous_id
  from public.analytics_events
  where event_name = 'invite_opened'
    and anonymous_id is not null
    and properties ->> 'team_id' is not null
),
signed_up as (
  select distinct anonymous_id
  from public.analytics_events
  where event_name = 'signup_completed'
    and anonymous_id is not null
)
select
  t.name                                                     as team,
  count(*)                                                   as invites_opened,
  count(*) filter (where s.anonymous_id is not null)         as became_accounts
from opened o
join public.teams t on t.id = o.team_id
left join signed_up s on s.anonymous_id = o.anonymous_id
group by t.name
order by invites_opened desc;

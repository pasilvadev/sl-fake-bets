-- =============================================================================
-- Share previews (UX-024) and the flag that proves ARC-016 works — roadmap
-- Phase 9, tasks 2 and 3.
--
-- No new tables: `analytics_events` and `feature_flags` already exist
-- (20260905120100_infra_tables.sql) and Phase 9 only fills them. What is
-- missing is a way to read ONE bet from outside its team, which is what a
-- social-card crawler is by definition.
-- =============================================================================

-- --- bet_preview ----------------------------------------------------------------
-- UX-024: a bet share link must render a card with the bet's title and its
-- current odds — to Slack's, WhatsApp's and Twitter's crawlers, none of which
-- carry a session. `bets` is membership-scoped by RLS (deliberately), so this
-- cannot be a SELECT, exactly as UX-023's team_preview_by_code cannot be.
--
-- The authorization model is the same one that document already accepted for
-- invite codes: **holding the id is the authorization.** A bet id is a v4 uuid
-- that appears nowhere but in the share URL its own team members generate, and
-- the function returns only what a preview card shows — no wagers, no member
-- names, no balances, no comments, and nothing that identifies who staked what.
--
-- One row per option. `bet_id`/`title`/… repeat across those rows; that is the
-- cheapest shape that keeps the options ORDERED (bet_options.position), and the
-- caller folds them in one pass.
create or replace function public.bet_preview(p_bet_id uuid)
returns table (
  bet_id          uuid,
  title           text,
  icon_emoji      text,
  state           public.bet_state,
  closes_at       timestamptz,
  resolution_kind public.bet_resolution_kind,
  team_name       text,
  option_id       uuid,
  option_label    text,
  option_position smallint,
  -- Total staked on this option. The pool split — share and payout multiplier —
  -- is derived from these by `poolStatsFromTotals` in packages/shared, so the
  -- odds on a share card come out of the same formula as the odds on the bet
  -- page (DOM-016, A-3: no rake).
  option_total    integer
) language sql security definer stable set search_path = '' as $$
  select
    b.id,
    b.title,
    b.icon_emoji,
    b.state,
    b.closes_at,
    b.resolution_kind,
    t.name,
    o.id,
    o.label,
    o.position,
    coalesce((
      select sum(w.amount)::integer from public.wagers w
       where w.bet_id = b.id and w.option_id = o.id
    ), 0)
  from public.bets b
  join public.teams t on t.id = b.team_id
  join public.bet_options o on o.bet_id = b.id
  where b.id = p_bet_id
  order by o.position;
$$;

comment on function public.bet_preview(uuid) is
  'UX-024 social-card source. Holding the bet id is the authorization, as holding an invite code is for team_preview_by_code. Returns one row per option; no wagerer identities.';

revoke execute on function public.bet_preview(uuid) from public;
grant execute on function public.bet_preview(uuid) to anon, authenticated;

-- --- the flag with a live consumer ----------------------------------------------
-- ARC-016 is satisfied by the table, but a mechanism nothing reads is a
-- mechanism nobody can prove works. The five flags seeded in
-- 20260905120100_infra_tables.sql all gate post-MVP FEATURES, and building one
-- to demonstrate the toggle would be exactly the scope creep Phase 9's guard
-- names (DOM-023 above all).
--
-- So the consumer is a flag over something that already exists: the "SOON"
-- teaser modules on the dashboard rail (UX-019's chat stub). Default `true` —
-- the dashboard keeps rendering what design-dashboard.md §4.4 specifies — and
-- flipping it to false in Studio empties the teaser on the next load, with no
-- deploy and no rebuild. That is ARC-016 demonstrated without implementing a
-- single post-MVP feature.
insert into public.feature_flags (key, enabled, description) values
  ('coming-soon-teasers', true,
   'Show the "SOON" placeholder modules for future features (UX-019 team chat stub). Off hides them. The live proof that ARC-016 toggling works — see apps/web/src/lib/feature-flags.tsx.')
on conflict (key) do nothing;

-- =============================================================================
-- First-run profile step — roadmap Phase 7.5.
--
-- Onboarding is signup → team (create or join) → confirm-your-profile →
-- dashboard (decision §4.7). The profile step is never required and is marked
-- done whether it was saved or skipped, which is what these two columns are:
--
--   * `onboarded_at` — NULL *is* "first run". No separate boolean and no
--     default, because a default would have to be a lie in one direction or
--     the other, and "have they finished onboarding" and "when" are the same
--     fact asked twice.
--   * `profile_prefill` — how good the pre-filled profile is. The step reads it
--     to decide which of its two actions is primary: a Google account arrives
--     with a name its owner actually chose, so the step is a confirmation
--     (primary = continue as-is); an email-OTP account arrives with an email
--     local part or the literal 'Player', which the user has never seen, so the
--     primary action saves and the skip names the placeholder it accepts.
--
-- This CANNOT be re-derived on the client. By the time the app sees the row,
-- 'Pedro' from Google and 'pedro' from pedro@example.com are the same string;
-- only the signup transaction knows which one it was. Hence a stored column,
-- written once, at the only moment the answer exists.
--
-- RLS: no new policy. `users_update_self` (Phase 3) is row-wide, so it already
-- covers both columns, and `users_select_self_or_teammate` makes them readable
-- to teammates — acceptable (neither is sensitive) and the reason they stay off
-- the shared `User` type rather than riding on every teammate object.
-- =============================================================================

alter table public.users
  add column onboarded_at timestamptz,
  add column profile_prefill text not null default 'derived'
    check (profile_prefill in ('provider', 'derived'));

comment on column public.users.onboarded_at is
  'When the first-run profile step was completed — saved OR skipped. NULL = first run (roadmap Phase 7.5).';

comment on column public.users.profile_prefill is
  'Quality of the signup-time profile prefill: ''provider'' = the OAuth provider gave a real name, ''derived'' = guessed from the email local part or the ''Player'' fallback. Chooses the first-run step''s emphasis.';

-- The two branches of that answer, kept beside each other on purpose: this is
-- the same falling order `app.default_display_name` prefers, minus its two
-- derived fallbacks. If a future provider adds a fourth metadata key, both
-- functions have to learn it — a name that is real for the display and derived
-- for the emphasis would put the step in its guilt-free-skip mode for a user
-- who is looking at their own name.
create or replace function app.profile_prefill_kind(p_meta jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(
      nullif(btrim(p_meta ->> 'full_name'), ''),
      nullif(btrim(p_meta ->> 'name'), ''),
      nullif(btrim(p_meta ->> 'display_name'), '')
    ) is not null then 'provider'
    else 'derived'
  end;
$$;

comment on function app.profile_prefill_kind(jsonb) is
  'Did the provider supply a real display name? Sets users.profile_prefill at signup (roadmap Phase 7.5).';

-- Phase 4's signup trigger, now also recording the prefill's provenance. The
-- body is otherwise unchanged — see 20260905130000_auth_profile_bootstrap.sql
-- for why it is a SECURITY DEFINER and why the ON CONFLICT is load-bearing.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, display_name, name_color, avatar, profile_prefill)
  values (
    new.id,
    app.default_display_name(new.email, new.raw_user_meta_data),
    app.default_name_color(),
    app.default_avatar(new.raw_user_meta_data),
    app.profile_prefill_kind(new.raw_user_meta_data)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Backfill. Every account that predates this migration has already been using
-- the app; showing it a "confirm your profile" screen after the fact would be
-- a first-run moment arriving late, which is worse than never arriving. The
-- owner's own OAuth account is in here.
--
-- `where onboarded_at is null` is every row today and is here for the shape of
-- the statement, not for a case it excludes.
update public.users
   set onboarded_at = now()
 where onboarded_at is null;

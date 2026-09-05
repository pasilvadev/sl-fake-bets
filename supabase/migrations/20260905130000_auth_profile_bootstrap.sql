-- =============================================================================
-- Profile bootstrap on signup — roadmap Phase 4.
--
-- `public.users` carries a comment from the Phase 3 domain schema that says
-- "Created on signup in Phase 4". This is that: every `auth.users` row gets a
-- matching profile row, pre-filled, in the same transaction as the signup.
--
-- Why a trigger and not the client, given that Phase 3 also left a
-- `users_insert_self` policy in place:
--
--   * There are two signup paths (email OTP verified in-page, Google OAuth
--     returning through /auth/callback) and a third in dev (seed.sql writing
--     auth.users directly). One trigger covers all three; a client-side insert
--     would have to be repeated per path and would still leave a profile-less
--     identity behind whenever the tab closes between the two round trips.
--   * UX-001 counts round trips. A profile that already exists costs the new
--     user nothing; one created by a follow-up request costs a request.
--
-- The `users_insert_self` policy stays: it is what lets a client repair a
-- profile it somehow lacks, and it constrains that write to the caller's own
-- row.
--
-- SECURITY DEFINER is correct HERE, and the Phase 3 warning still stands.
-- That warning is about triggers that GATE writes: inside a definer function
-- `current_user` is `postgres`, so `app.is_service_context()` reads true and
-- such a trigger disarms itself. This trigger gates nothing — it only inserts,
-- and it must be a definer because the inserting role during signup is GoTrue's
-- `supabase_auth_admin`, which has no rights on `public.users`.
-- =============================================================================

-- UX-002: "every customizable onboarding input ships pre-filled". These are the
-- placeholder generators. They live in SQL because signup happens inside the
-- database transaction that creates the identity; validateProfileDraft
-- (validation.ts) remains the source of truth for what a user may LATER set,
-- and the profile modal is where a user who cares changes any of this.

-- Display name from whatever the provider gave us, in falling order of quality:
-- Google's full name, its account name, then the email local part. Never empty
-- (the column's CHECK forbids it) — an address with no local part falls back to
-- a generic, still-valid placeholder.
create or replace function app.default_display_name(
  p_email text,
  p_meta jsonb
)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(btrim(p_meta ->> 'full_name'), ''),
    nullif(btrim(p_meta ->> 'name'), ''),
    nullif(btrim(p_meta ->> 'display_name'), ''),
    nullif(btrim(split_part(coalesce(p_email, ''), '@', 1)), ''),
    'Player'
  );
$$;

-- The 10 curated NAME_COLORS (config.ts / design-visual-identity.md §2.4),
-- duplicated here ON PURPOSE and only as a DEFAULT: the column's CHECK pins
-- hex shape, validateProfileDraft pins the palette, and this list picks one
-- starting value. If design retunes a swatch, a stale default here shows a
-- slightly-off color to brand-new users until this migration's successor
-- updates it — the drift is visible and harmless, which is the trade Phase 3
-- already made when it refused to pin the palette in a CHECK constraint.
create or replace function app.default_name_color()
returns text language sql volatile set search_path = '' as $$
  select (array[
    '#2C9297', '#2C91AA', '#2B8DBF', '#2D88EC', '#647BF1',
    '#8C70F2', '#B45CF5', '#DB36E3', '#EC35B3', '#F33483'
  ])[floor(random() * 10)::int + 1];
$$;

-- Avatar. Google hands us a real profile picture (`avatar_url`/`picture` in the
-- identity metadata) and UX-002 says a pre-filled default should be the best
-- one available — someone who signed in with Google expects to see their own
-- face, not a dice icon. `user-avatar.tsx` already renders any http(s) value as
-- an image and falls back to initials, so no client change is needed.
--
-- Only https is accepted: the value is provider-controlled and lands in an
-- `<img src>`, so a `javascript:`/`data:` URL has no business reaching it.
--
-- Everyone else falls back to the platform icon set (UX-022) — deliberately
-- the 8 ids the profile modal can actually render, because a default the user
-- cannot re-select in the picker would be a dead end. (mock-data.ts also uses
-- `icon-fish` and `icon-target`, which the picker does not offer; that
-- predates this phase and is left alone.)
--
-- Note this stores an EXTERNAL url, a third kind of value alongside icon ids
-- and Phase 3's avatars-bucket paths. That is intended and self-healing: the
-- link dies only if the user changes their Google picture, and Phase 5's
-- profile modal overwrites the field the moment they pick anything else.
create or replace function app.default_avatar(p_meta jsonb default '{}'::jsonb)
returns text language sql volatile set search_path = '' as $$
  select coalesce(
    (
      select url
      from (values
        (nullif(btrim(p_meta ->> 'avatar_url'), '')),
        (nullif(btrim(p_meta ->> 'picture'), ''))
      ) as candidates(url)
      where url like 'https://%'
      limit 1
    ),
    (array[
      'icon-dice', 'icon-crown', 'icon-ghost', 'icon-flame',
      'icon-bolt', 'icon-star', 'icon-skull', 'icon-moon'
    ])[floor(random() * 8)::int + 1]
  );
$$;

create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, display_name, name_color, avatar)
  values (
    new.id,
    app.default_display_name(new.email, new.raw_user_meta_data),
    app.default_name_color(),
    app.default_avatar(new.raw_user_meta_data)
  )
  -- seed.sql writes auth.users directly and then upserts the fixture profiles
  -- over these defaults; a signup that somehow re-runs must also not fail.
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

comment on function app.handle_new_user() is
  'UX-002 pre-filled profile for every new auth identity (roadmap Phase 4).';

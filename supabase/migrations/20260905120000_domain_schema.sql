-- =============================================================================
-- SL Fake Bets — domain schema
-- Roadmap Phase 3 (= vision Phase 1→2, ARC-011, authorized under ARC-013).
--
-- Mirrors packages/shared/src/types.ts field-for-field. Two deliberate
-- representation changes, both required by Postgres/Supabase rather than by a
-- change of design:
--
--  1. Ids are `uuid`, not the `b-…`/`t-…` prefixed strings from id.ts.
--     `public.users.id` MUST equal `auth.users.id` (a uuid), and a schema that
--     mixed uuid and prefixed-text keys would need two id conventions. TS still
--     sees `string` either way, so types.ts is unchanged.
--  2. `Team.inviteCode` (scalar) becomes the `invite_codes` table, as the
--     roadmap's table list requires. One active row per team reproduces today's
--     single code; the table shape is what lets open decision #6 (manual
--     revoke/regenerate, UX-005/DOM-005) land later without a redesign.
--
-- ARC-015 (notifications must attach later without redesign): every table that
-- could ever raise a notification carries a stable uuid primary key, the actor
-- (`user_id`/`creator_id`), and `created_at`. A future `notification_events`
-- table hangs off those keys; team scope is always reachable (wagers/comments →
-- bets → team_id). Deliberately NOT denormalizing team_id onto wagers/comments:
-- a join is not a redesign, a duplicated column is a drift source.
-- =============================================================================

-- --- enums: the closed unions from types.ts -----------------------------------

-- DOM-003: two assignable roles. Leader is a status on the team, not a role.
create type public.team_role as enum ('moderator', 'member');

-- DOM-002: gates bet creation and invite creation, nothing else.
create type public.team_access_mode as enum ('free-for-all', 'restricted');

-- DOM-012: strictly ordered lifecycle.
create type public.bet_state as enum ('open', 'closed', 'resolved');

-- DOM-018/019: the discriminant of types.ts's BetResolution union.
create type public.bet_resolution_kind as enum ('winner', 'void');

-- DOM-025 + decision §4.6: stays the 4-value union. Wager stakes, payouts and
-- void refunds are NOT ledger rows — do not extend this type.
create type public.transaction_kind as enum (
  'onboarding-grant',
  'daily-reward',
  'injection',
  'donation'  -- reserved for post-MVP DOM-023; unused at MVP.
);

-- --- users --------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  -- UX-002: every field ships pre-filled, so all three are NOT NULL.
  display_name text not null check (length(btrim(display_name)) > 0),
  -- UX-022: one of the 10 curated NAME_COLORS (config.ts). The check is on hex
  -- SHAPE, not the exact palette: validateProfileDraft owns the palette, and
  -- pinning 10 literals here would mean a migration every time design retunes
  -- a swatch.
  name_color text not null check (name_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Platform icon id (e.g. 'icon-dice') or an avatars-bucket URL.
  avatar text not null check (length(btrim(avatar)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.users is
  'Profile row per auth.users identity (UX-022). Created on signup in Phase 4.';

-- --- teams --------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  -- DOM-001: exactly one leader, always. Enforced as a single scalar column
  -- rather than a role value, so "exactly one" is structurally impossible to
  -- violate. RESTRICT: the leader's row cannot vanish under the team.
  leader_id uuid not null references public.users (id) on delete restrict,
  access_mode public.team_access_mode not null,
  created_at timestamptz not null default now()
);

create index teams_leader_id_idx on public.teams (leader_id);

-- --- team_members -------------------------------------------------------------

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.team_role not null default 'member',
  -- DOM-013: balance is per-team, never global. DOM-014: never negative.
  -- Decision §4.6: stored, not event-sourced by replaying transactions.
  coin_balance integer not null default 0 check (coin_balance >= 0),
  -- DOM-026: aggregated realized profit/loss; negative is the normal case for
  -- the "podium of the poor" (DOM-028), so no non-negative check here.
  profit_loss integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);

comment on column public.team_members.coin_balance is
  'DOM-013/014. Mutated only via settlement/ledger paths, never a raw client write (see the update trigger).';

-- --- team_bans ----------------------------------------------------------------
-- Not in the roadmap's table list, but types.ts's Team.bannedUserIds names this
-- exact table for this exact phase: "Kept as its own list because the membership
-- row is gone (Phase 3 maps it to a `team_bans` table)". Without it, A-4's
-- ban-blocks-rejoin (the only functional difference from a kick, DOM-031) has
-- nowhere to persist, and Phase 5 would need a schema migration — which is what
-- "full schema in one pass" exists to prevent.

create table public.team_bans (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  banned_by uuid references public.users (id) on delete set null,
  banned_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_bans_user_id_idx on public.team_bans (user_id);

-- --- invite_codes -------------------------------------------------------------

create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- UX-005/DOM-005: no expiry column by design. Codes die only by revocation.
  code text not null unique check (length(btrim(code)) > 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Open decision #6: manual revoke. Null = active.
  revoked_at timestamptz
);

-- One active code per team reproduces today's Team.inviteCode scalar.
create unique index invite_codes_one_active_per_team_idx
  on public.invite_codes (team_id)
  where revoked_at is null;

-- --- bets ---------------------------------------------------------------------

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  creator_id uuid not null references public.users (id) on delete restrict,
  -- DOM-030/DOM-035: free-form, any subject. No moderation columns, ever.
  title text not null check (length(btrim(title)) > 0),
  -- DOM-009: optional, emoji only at MVP.
  icon_emoji text,
  state public.bet_state not null default 'open',
  -- DOM-012: exactly when open→closed happens automatically.
  closes_at timestamptz not null,
  -- DOM-017: caps a user's TOTAL stake on the bet (see validateWager).
  max_wager_per_user integer not null check (max_wager_per_user >= 1),
  -- types.ts BetResolution, flattened. The shape check below is what keeps the
  -- union honest: no resolution data before 'resolved', a winner always names
  -- an option, a void never does.
  resolution_kind public.bet_resolution_kind,
  winning_option_id uuid,
  created_at timestamptz not null default now(),

  constraint bets_resolution_shape check (
    (state <> 'resolved' and resolution_kind is null and winning_option_id is null)
    or (state = 'resolved' and resolution_kind = 'void' and winning_option_id is null)
    or (state = 'resolved' and resolution_kind = 'winner' and winning_option_id is not null)
  )
);

-- UX-008: open bets first, soonest-closing first — the dashboard's only sort.
create index bets_team_feed_idx on public.bets (team_id, state, closes_at);
create index bets_creator_id_idx on public.bets (creator_id);

-- --- bet_options --------------------------------------------------------------

create table public.bet_options (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  -- types.ts models options as an ordered array; a set of rows is not ordered.
  position smallint not null check (position >= 0),

  -- Target for the composite FKs below: proves "this option belongs to that bet"
  -- inside the FK itself, instead of trusting application code to check.
  unique (bet_id, id),
  unique (bet_id, position)
);

comment on table public.bet_options is
  'DOM-007 requires at least 2 options. That is a row-count invariant, which a CHECK cannot express; it is enforced by validateBetDraft (MIN_BET_OPTIONS) and, from Phase 6, by the createBet RPC.';

-- Circular by nature: a bet points at its winning option, an option points at
-- its bet. Deferrable so one transaction can insert both (the seed does).
alter table public.bets
  add constraint bets_winning_option_belongs_to_bet
  foreign key (id, winning_option_id)
  references public.bet_options (bet_id, id)
  deferrable initially deferred;

-- --- wagers -------------------------------------------------------------------

create table public.wagers (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  -- DOM-014: a stake is a positive whole number. The over-balance and
  -- per-user-max halves are validateWager's, since both need context this row
  -- does not have.
  amount integer not null check (amount >= 1),
  placed_at timestamptz not null default now(),

  -- The option must belong to THIS bet. Composite FK, not application logic.
  foreign key (bet_id, option_id)
    references public.bet_options (bet_id, id) on delete cascade
);

-- Deliberately no unique (bet_id, user_id): repeat wagers are legal, and
-- validateWager caps the user's accumulated stake (existingStake), not the
-- number of rows.
create index wagers_bet_id_idx on public.wagers (bet_id);
create index wagers_user_id_idx on public.wagers (user_id);

-- --- transactions -------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  kind public.transaction_kind not null,
  -- ledger.ts: non-zero integer; negative = debit (future donations).
  amount integer not null check (amount <> 0),
  description text not null default '',
  -- Snapshot of coin_balance immediately after this entry. applyTransaction
  -- computes the two together so they cannot drift.
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index transactions_team_user_idx
  on public.transactions (team_id, user_id, created_at desc);

-- Decision §4.2: the onboarding grant is per MEMBERSHIP, applied once on
-- create/join. A partial unique index makes a double grant impossible rather
-- than merely unlikely.
create unique index transactions_one_onboarding_grant_per_membership_idx
  on public.transactions (team_id, user_id)
  where kind = 'onboarding-grant';

-- Decision §4.3: the daily reward is per (user, team, calendar day). UTC is the
-- calendar: `timezone(text, timestamptz)` is IMMUTABLE, so this is indexable —
-- a session-local ::date would not be.
create unique index transactions_one_daily_reward_per_day_idx
  on public.transactions (
    team_id,
    user_id,
    (timezone('UTC', created_at)::date)
  )
  where kind = 'daily-reward';

comment on table public.transactions is
  'DOM-025 transfer ledger: grants, daily rewards, leader injections (donation reserved for DOM-023). DOM-026/decision §4.6: wager stakes and payouts are NOT rows here. Append-only — RLS grants no UPDATE or DELETE to anyone.';

-- --- comments -----------------------------------------------------------------

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references public.bets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- DOM-030: no moderation system. No flag/hidden/deleted_at columns by design.
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index comments_bet_id_created_at_idx on public.comments (bet_id, created_at);

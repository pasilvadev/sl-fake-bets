-- =============================================================================
-- Dev seed — packages/shared/src/mock-data.ts, translated to Postgres rows.
--
-- Runs on every `supabase db reset` (config.toml [db.seed]). DEV ONLY: it writes
-- auth.users directly, which nothing outside a local stack should ever do.
--
-- Ids are deterministic, not random, and readable by block so a row can be
-- traced back to its fixture at a glance:
--
--   00000000-…-0000000000NN  users        u-NN
--   10000000-…-00000000000N  teams        t-0N
--   20000000-…-00000000000N  bets         b-0N
--   30000000-…-0000000BB0O   bet_options  b-BB-oO   (BB = bet, O = option)
--   40000000-…-0000000000NN  wagers       w-NN
--   50000000-…-0000000000NN  comments     c-NN
--   60000000-…-0000000000NN  transactions tx-NN
--   70000000-…-00000000000N  invite_codes (one per team)
--
-- ONE transaction for the whole file. Two schema-level constraints require it:
-- the deferred DOM-001 leader-is-a-member trigger (a team is inserted before its
-- membership rows) and the deferred bets→bet_options winning-option FK (a
-- resolved bet names an option row created after it). Under psql's default
-- autocommit both would fail at the end of their own statement.
-- =============================================================================

begin;
set constraints all deferred;

-- --- auth identities ------------------------------------------------------------
-- The 10 fixture users need real auth.users rows: public.users.id is a foreign
-- key onto auth.users.id, which is what makes the seeded world reachable from a
-- signed-in session at all.
--
-- Local dev password for every seeded account: `slfakebets`. The product's real
-- flavor is email OTP (decision §4.1) — the password exists only so a developer
-- can jump straight into a specific member's view while testing RLS.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('slfakebets', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  '', '', '', ''
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'rafa@sl.local',   'Rafa'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'duds@sl.local',   'Duds'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'pri@sl.local',    'Pri'),
  ('00000000-0000-4000-a000-000000000004'::uuid, 'tomate@sl.local', 'Tomate'),
  ('00000000-0000-4000-a000-000000000005'::uuid, 'careca@sl.local', 'Careca'),
  ('00000000-0000-4000-a000-000000000006'::uuid, 'nina@sl.local',   'Nina'),
  ('00000000-0000-4000-a000-000000000007'::uuid, 'guiz@sl.local',   'Guiz'),
  ('00000000-0000-4000-a000-000000000008'::uuid, 'lele@sl.local',   'Lelê'),
  ('00000000-0000-4000-a000-000000000009'::uuid, 'pinto@sl.local',  'Pinto'),
  ('00000000-0000-4000-a000-000000000010'::uuid, 'xis@sl.local',    'Xis')
) as u(id, email, display_name);

-- GoTrue resolves an email login through auth.identities, not auth.users alone;
-- without these rows the seeded accounts exist but cannot sign in.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(), now(), now()
from auth.users u
where u.email like '%@sl.local';

-- --- users (UX-022 profiles) --------------------------------------------------------
-- nameColor values are the 10 curated NAME_COLORS (config.ts), one per user, in
-- palette order — same as the fixture.
--
-- UPSERT, not a plain insert: since Phase 4 the `on_auth_user_created` trigger
-- has already created a randomly pre-filled profile for each auth row inserted
-- above. The fixture values are the ones that must win, so this overwrites them.

insert into public.users (id, display_name, name_color, avatar, created_at) values
  ('00000000-0000-4000-a000-000000000001', 'Rafa',   '#2C9297', 'icon-dice',   '2026-08-01T18:00:00Z'),
  ('00000000-0000-4000-a000-000000000002', 'Duds',   '#2C91AA', 'icon-crown',  '2026-08-01T18:05:00Z'),
  ('00000000-0000-4000-a000-000000000003', 'Pri',    '#2B8DBF', 'icon-ghost',  '2026-08-01T19:12:00Z'),
  ('00000000-0000-4000-a000-000000000004', 'Tomate', '#2D88EC', 'icon-flame',  '2026-08-02T10:30:00Z'),
  ('00000000-0000-4000-a000-000000000005', 'Careca', '#647BF1', 'icon-bolt',   '2026-08-02T11:00:00Z'),
  ('00000000-0000-4000-a000-000000000006', 'Nina',   '#8C70F2', 'icon-star',   '2026-08-03T14:45:00Z'),
  ('00000000-0000-4000-a000-000000000007', 'Guiz',   '#B45CF5', 'icon-skull',  '2026-08-05T09:20:00Z'),
  ('00000000-0000-4000-a000-000000000008', 'Lelê',   '#DB36E3', 'icon-moon',   '2026-08-07T21:10:00Z'),
  ('00000000-0000-4000-a000-000000000009', 'Pinto',  '#EC35B3', 'icon-fish',   '2026-08-10T16:40:00Z'),
  ('00000000-0000-4000-a000-000000000010', 'Xis',    '#F33483', 'icon-target', '2026-09-01T12:00:00Z')
on conflict (id) do update set
  display_name = excluded.display_name,
  name_color   = excluded.name_color,
  avatar       = excluded.avatar,
  created_at   = excluded.created_at;

-- The fixtures are established personas with hand-picked names and colors, so
-- none of them is on its first run (roadmap Phase 7.5): signing in as Rafa to
-- test something must land on the dashboard, not on "confirm your profile".
-- To see the step, sign up a fresh account — that is the case it exists for.
update public.users
   set onboarded_at = created_at
 where id between '00000000-0000-4000-a000-000000000001'
               and '00000000-0000-4000-a000-000000000010';

-- --- teams ---------------------------------------------------------------------------

insert into public.teams (id, name, leader_id, access_mode, created_at) values
  ('10000000-0000-4000-a000-000000000001', 'SL Originals',      '00000000-0000-4000-a000-000000000001', 'free-for-all', '2026-08-01T18:00:00Z'),
  ('10000000-0000-4000-a000-000000000002', 'Lanhouse Legends',  '00000000-0000-4000-a000-000000000002', 'restricted',   '2026-07-15T20:00:00Z'),
  ('10000000-0000-4000-a000-000000000003', 'Churrasco FC',      '00000000-0000-4000-a000-000000000005', 'free-for-all', '2026-08-20T12:00:00Z');

-- Team.inviteCode, now one active row per team (see the domain-schema header).
insert into public.invite_codes (id, team_id, code, created_by, created_at) values
  ('70000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'sl-originals-4ever',  '00000000-0000-4000-a000-000000000001', '2026-08-01T18:00:00Z'),
  ('70000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002', 'lanhouse-legends-gg', '00000000-0000-4000-a000-000000000002', '2026-07-15T20:00:00Z'),
  ('70000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000003', 'churrasco-fc-2026',   '00000000-0000-4000-a000-000000000005', '2026-08-20T12:00:00Z');

-- --- team_members --------------------------------------------------------------------
-- coin_balance and profit_loss are the fixture's DERIVED values, pinned by
-- settlement.test.ts: a stake leaves the balance at placement, so
-- balance = ledger credits − stakes in flight + resolved payouts/refunds, and
-- profit_loss is the realized outcome of the resolved bets only (b-05, b-06).
-- Note the leader rows carry role 'member': leader is a status on the team, not
-- a role (DOM-003).

insert into public.team_members (team_id, user_id, role, coin_balance, profit_loss, joined_at) values
  -- t-01 "SL Originals"
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'member',     45, -15, '2026-08-01T18:00:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'moderator', 110,  50, '2026-08-01T18:05:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'moderator',  80,   0, '2026-08-01T19:12:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', 'member',     30, -60, '2026-08-02T10:30:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'member',     90,   0, '2026-08-02T11:00:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'member',    105,  25, '2026-08-03T14:45:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000007', 'member',     60,   0, '2026-08-05T09:20:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000008', 'member',     65,   0, '2026-08-07T21:10:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000009', 'member',    100,   0, '2026-08-10T16:40:00Z'),
  -- Newest member: the 100-coin grant minus the 20 still in flight on b-02 (w-07).
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000010', 'member',     80,   0, '2026-09-01T12:00:00Z'),
  -- t-02 "Lanhouse Legends" (restricted) and t-03 "Churrasco FC" exist to give
  -- the team switcher somewhere to switch TO (UX-009/010); neither has a single
  -- bet. Their balances are therefore their ledger and nothing else — grants
  -- plus the daily rewards below — and their profit/loss is 0, because DOM-026
  -- P/L is the realized outcome of resolved bets and there are none to realize.
  -- (These rows used to carry 300/±200-style figures with no ledger and no bets
  -- behind them; Phase 7's consistency guard is what found that, which is the
  -- entire reason it exists.)
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'member',    110,   0, '2026-07-15T20:00:00Z'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'moderator', 100,   0, '2026-07-15T20:10:00Z'),
  ('10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000007', 'member',    105,   0, '2026-07-16T10:00:00Z'),
  -- t-03 "Churrasco FC"
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000005', 'member',    100,   0, '2026-08-20T12:00:00Z'),
  ('10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'member',    100,   0, '2026-08-21T09:00:00Z');

-- --- bets ------------------------------------------------------------------------------
-- Every lifecycle state is represented (ARC-010 wants the product to feel
-- near-final): three open, one closed, one resolved-with-winner, one resolved-void.

insert into public.bets (id, team_id, creator_id, title, icon_emoji, state, closes_at, max_wager_per_user, resolution_kind, winning_option_id, created_at) values
  ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'Careca chega atrasado no churrasco de sábado?',        '🍖',   'open',     '2026-09-05T14:00:00Z', 100, null,     null,                                   '2026-09-02T20:00:00Z'),
  ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Quantos gols o time do Guiz toma no domingo?',         '⚽',   'open',     '2026-09-06T15:00:00Z',  50, null,     null,                                   '2026-09-03T09:30:00Z'),
  ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'Nina termina a maratona de One Piece antes de outubro?', '🏴‍☠️', 'open',     '2026-09-30T23:59:00Z', 100, null,     null,                                   '2026-08-28T22:15:00Z'),
  ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'Pinto fica sem bateria no meio da call de novo?',      '🔋',   'closed',   '2026-09-03T19:00:00Z',  25, null,     null,                                   '2026-09-01T18:00:00Z'),
  ('20000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'Tomate ganha a ranqueada até sexta?',                  '🎮',   'resolved', '2026-08-28T18:00:00Z', 100, 'winner', '30000000-0000-4000-a000-000000000502', '2026-08-25T12:00:00Z'),
  ('20000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'Chove no rolê de quinta?',                             '🌧️',  'resolved', '2026-08-27T17:00:00Z',  30, 'void',   null,                                   '2026-08-26T08:00:00Z');

insert into public.bet_options (id, bet_id, label, position) values
  ('30000000-0000-4000-a000-000000000101', '20000000-0000-4000-a000-000000000001', 'Yes, as always',      0),
  ('30000000-0000-4000-a000-000000000102', '20000000-0000-4000-a000-000000000001', 'No, miracle happens', 1),
  ('30000000-0000-4000-a000-000000000201', '20000000-0000-4000-a000-000000000002', '0–1',                 0),
  ('30000000-0000-4000-a000-000000000202', '20000000-0000-4000-a000-000000000002', '2–3',                 1),
  ('30000000-0000-4000-a000-000000000203', '20000000-0000-4000-a000-000000000002', '4+',                  2),
  ('30000000-0000-4000-a000-000000000301', '20000000-0000-4000-a000-000000000003', 'Yes',                 0),
  ('30000000-0000-4000-a000-000000000302', '20000000-0000-4000-a000-000000000003', 'No chance',           1),
  ('30000000-0000-4000-a000-000000000401', '20000000-0000-4000-a000-000000000004', 'Yes',                 0),
  ('30000000-0000-4000-a000-000000000402', '20000000-0000-4000-a000-000000000004', 'No',                  1),
  ('30000000-0000-4000-a000-000000000501', '20000000-0000-4000-a000-000000000005', 'Wins',                0),
  ('30000000-0000-4000-a000-000000000502', '20000000-0000-4000-a000-000000000005', 'Loses',               1),
  ('30000000-0000-4000-a000-000000000601', '20000000-0000-4000-a000-000000000006', 'Rain',                0),
  ('30000000-0000-4000-a000-000000000602', '20000000-0000-4000-a000-000000000006', 'Dry',                 1);

-- --- wagers ------------------------------------------------------------------------------
-- Pools: b-01 = 85, b-02 = 95, b-03 = 60, b-04 = 45, b-05 = 135, b-06 = 50.

insert into public.wagers (id, bet_id, option_id, user_id, amount, placed_at) values
  ('40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000001', 30, '2026-09-02T20:10:00Z'),
  ('40000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000003', 20, '2026-09-02T21:00:00Z'),
  ('40000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000102', '00000000-0000-4000-a000-000000000006', 25, '2026-09-03T10:05:00Z'),
  ('40000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000101', '00000000-0000-4000-a000-000000000005', 10, '2026-09-03T11:30:00Z'),
  ('40000000-0000-4000-a000-000000000005', '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000202', '00000000-0000-4000-a000-000000000007', 40, '2026-09-03T10:00:00Z'),
  ('40000000-0000-4000-a000-000000000006', '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000203', '00000000-0000-4000-a000-000000000008', 35, '2026-09-03T12:20:00Z'),
  ('40000000-0000-4000-a000-000000000007', '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000201', '00000000-0000-4000-a000-000000000010', 20, '2026-09-03T18:45:00Z'),
  ('40000000-0000-4000-a000-000000000008', '20000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000002', 50, '2026-08-29T09:00:00Z'),
  ('40000000-0000-4000-a000-000000000009', '20000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000004', 10, '2026-08-30T15:30:00Z'),
  ('40000000-0000-4000-a000-000000000010', '20000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000401', '00000000-0000-4000-a000-000000000001', 25, '2026-09-01T18:30:00Z'),
  ('40000000-0000-4000-a000-000000000011', '20000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000402', '00000000-0000-4000-a000-000000000009', 20, '2026-09-02T09:10:00Z'),
  -- b-05: u-01 backed the losing side, so the dashboard renders the current
  -- user's own "LOST" outcome glyph.
  ('40000000-0000-4000-a000-000000000017', '20000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000001', 15, '2026-08-25T12:30:00Z'),
  ('40000000-0000-4000-a000-000000000012', '20000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000501', '00000000-0000-4000-a000-000000000004', 60, '2026-08-25T13:00:00Z'),
  ('40000000-0000-4000-a000-000000000013', '20000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000502', '00000000-0000-4000-a000-000000000002', 40, '2026-08-25T14:20:00Z'),
  ('40000000-0000-4000-a000-000000000014', '20000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000502', '00000000-0000-4000-a000-000000000006', 20, '2026-08-26T10:00:00Z'),
  -- b-06: resolved void, every stake refunded (DOM-019).
  ('40000000-0000-4000-a000-000000000015', '20000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000601', '00000000-0000-4000-a000-000000000005', 30, '2026-08-26T08:30:00Z'),
  ('40000000-0000-4000-a000-000000000016', '20000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000602', '00000000-0000-4000-a000-000000000008', 20, '2026-08-26T09:15:00Z');

-- --- comments (UX-018) ----------------------------------------------------------------------

insert into public.comments (id, bet_id, user_id, body, created_at) values
  ('50000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', 'Easy money, ele NUNCA chegou no horário', '2026-09-02T20:15:00Z'),
  ('50000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'dessa vez eu chego, confia',              '2026-09-02T20:22:00Z'),
  ('50000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'apostando no milagre só pela odd',        '2026-09-03T10:06:00Z'),
  ('50000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000007', 'meu time é ruim mas não TÃO ruim',        '2026-09-03T10:05:00Z'),
  ('50000000-0000-4000-a000-000000000005', '20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000008', '4+ fácil, zagueiro tá lesionado',         '2026-09-03T12:22:00Z'),
  ('50000000-0000-4000-a000-000000000006', '20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000006', 'tô no episódio 400 já, relaxa',           '2026-08-29T10:00:00Z'),
  ('50000000-0000-4000-a000-000000000007', '20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002', '400 de 1100+... boa sorte',               '2026-08-29T10:30:00Z'),
  ('50000000-0000-4000-a000-000000000008', '20000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002', 'GG, pagou 2x',                            '2026-08-28T19:00:00Z'),
  ('50000000-0000-4000-a000-000000000009', '20000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000005', 'nem choveu nem fez sol, anulada justa',   '2026-08-27T18:00:00Z');

-- --- transactions (DOM-025 ledger) ----------------------------------------------------------
-- One onboarding grant per membership (decision §4.2), daily rewards for the
-- members who logged in on those days (decision §4.3), one leader injection
-- (DOM-024). balance_after snapshots interleave with wager stakes and payouts,
-- which are deliberately NOT ledger rows (DOM-026, decision §4.6) — that is why
-- the running balances here skip amounts with no matching row.

insert into public.transactions (id, team_id, user_id, kind, amount, description, balance_after, created_at) values
  ('60000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-01T18:00:00Z'),
  ('60000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-01T18:05:00Z'),
  ('60000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-01T19:12:00Z'),
  ('60000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-02T10:30:00Z'),
  ('60000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-02T11:00:00Z'),
  ('60000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-03T14:45:00Z'),
  ('60000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000007', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-05T09:20:00Z'),
  ('60000000-0000-4000-a000-000000000008', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000008', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-07T21:10:00Z'),
  ('60000000-0000-4000-a000-000000000009', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000009', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-08-10T16:40:00Z'),
  ('60000000-0000-4000-a000-000000000010', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000010', 'onboarding-grant', 100, 'Onboarding grant', 100, '2026-09-01T12:00:00Z'),
  -- u-01's chain: 100 −15 (w-17) → +5 = 90 → −25 (w-10) → +5 = 70 → −30 (w-01) → +5 = 45.
  ('60000000-0000-4000-a000-000000000011', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'daily-reward',       5, 'Daily login reward',  90, '2026-09-01T09:12:00Z'),
  ('60000000-0000-4000-a000-000000000012', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'daily-reward',       5, 'Daily login reward', 105, '2026-09-01T10:02:00Z'),
  ('60000000-0000-4000-a000-000000000013', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'daily-reward',       5, 'Daily login reward',  70, '2026-09-02T08:45:00Z'),
  ('60000000-0000-4000-a000-000000000014', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'daily-reward',       5, 'Daily login reward', 110, '2026-09-03T09:40:00Z'),
  ('60000000-0000-4000-a000-000000000015', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000009', 'injection',         20, 'Injected by Rafa (leader)', 100, '2026-09-03T14:00:00Z'),
  ('60000000-0000-4000-a000-000000000016', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'daily-reward',       5, 'Daily login reward',  45, '2026-09-04T07:30:00Z'),
  ('60000000-0000-4000-a000-000000000017', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'daily-reward',       5, 'Daily login reward', 105, '2026-09-04T08:15:00Z'),
  -- t-02 / t-03. Decision §4.2 is per MEMBERSHIP, not per user: u-01 belongs to
  -- all three teams and is granted in all three, because DOM-013 balances are
  -- per-team. With no bets in either team these rows ARE the balances above.
  ('60000000-0000-4000-a000-000000000018', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'onboarding-grant', 100, 'Onboarding grant',   100, '2026-07-15T20:00:00Z'),
  ('60000000-0000-4000-a000-000000000019', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'onboarding-grant', 100, 'Onboarding grant',   100, '2026-07-15T20:10:00Z'),
  ('60000000-0000-4000-a000-000000000020', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000007', 'onboarding-grant', 100, 'Onboarding grant',   100, '2026-07-16T10:00:00Z'),
  ('60000000-0000-4000-a000-000000000021', '10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000005', 'onboarding-grant', 100, 'Onboarding grant',   100, '2026-08-20T12:00:00Z'),
  ('60000000-0000-4000-a000-000000000022', '10000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'onboarding-grant', 100, 'Onboarding grant',   100, '2026-08-21T09:00:00Z'),
  -- Two members who opened Lanhouse Legends on a day they were around for.
  -- Per (user, team, day), so these coexist with u-02's t-01 rewards above.
  ('60000000-0000-4000-a000-000000000023', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'daily-reward',       5, 'Daily login reward', 105, '2026-09-01T10:03:00Z'),
  ('60000000-0000-4000-a000-000000000024', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000007', 'daily-reward',       5, 'Daily login reward', 105, '2026-09-02T19:20:00Z'),
  ('60000000-0000-4000-a000-000000000025', '10000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'daily-reward',       5, 'Daily login reward', 110, '2026-09-03T09:41:00Z');

commit;

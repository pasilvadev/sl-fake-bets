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
--   70000000-…-00000000000N  invite_codes: …0001-…0003 are the one-per-team
--                             permanent link from before; …0004-…0006 are
--                             plan-invite-links.md Phase 1 task 11's t-01
--                             demo rows (a live temporary, an expired
--                             temporary, a revoked permanent)
--
-- `bet_duels` gets no block of its own: its primary key IS its bet's id
-- (`bet_id uuid primary key references bets`), so a duel is reachable by the
-- 20000000-… id of the bet it hangs off and inventing a second identifier for
-- it would be inventing a row shape the schema does not have.
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

-- plan-invite-links.md Phase 1 task 11: three more t-01 rows so every filter in
-- team_preview_by_code/join_team_with_code (D3's lazy-expiry predicate) has a
-- row to exercise on a fresh `db reset` — a live temporary link, an expired
-- temporary link, and a revoked permanent link. `created_at`/`expires_at` on
-- the first two are deliberately `now()`-relative, unlike every other
-- timestamp in this file: the "live" and "expired" rows have to still BE live
-- or expired whenever this file runs, which a fixed date could not promise on
-- the next `db reset` a week from now. mock-data.ts's TypeScript twin (Phase 2)
-- uses fixed dates instead, because its tests inject `now` and never read the
-- wall clock.
insert into public.invite_codes (id, team_id, code, created_by, created_at, expires_at, revoked_at) values
  ('70000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', 'originals-day-pass',   '00000000-0000-4000-a000-000000000002', now(),                     now() + interval '20 hours', null),
  ('70000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', 'originals-stale-pass', '00000000-0000-4000-a000-000000000001', now() - interval '2 days', now() - interval '1 day',    null),
  ('70000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000001', 'originals-old-link',   '00000000-0000-4000-a000-000000000001', '2026-07-01T12:00:00Z',    null,                         '2026-07-02T12:00:00Z');

-- --- team_members --------------------------------------------------------------------
-- coin_balance and profit_loss are the fixture's DERIVED values, pinned by
-- settlement.test.ts: a stake leaves the balance at placement, so
-- balance = ledger credits − stakes in flight + resolved payouts/refunds, and
-- profit_loss is the realized outcome of the resolved bets only (b-05, b-06).
--
-- That formula is Phase 7's consistency guard verbatim
-- (apps/web/src/lib/data/consistency-guard.ts), scoped per member to rows at or
-- after joined_at, and it is the thing to re-derive before editing any number
-- below. Three of the t-01 balances carry a DUEL stake as well as pool ones
-- (Extra Phase 2, the section further down): u-06 −40, u-07 −25, u-09 −25.
-- The guard does not know or care that those stakes belong to duels — a duel
-- wager is a `wagers` row like any other, which is exactly why duels needed no
-- settlement path of their own. u-08 has been CHALLENGED and has not answered,
-- so his balance is untouched; money moves twice and never on credit (D5), and
-- that asymmetry is the one thing to get right here.
-- Note the leader rows carry role 'member': leader is a status on the team, not
-- a role (DOM-003).

insert into public.team_members (team_id, user_id, role, coin_balance, profit_loss, joined_at) values
  -- t-01 "SL Originals"
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'member',     45, -15, '2026-08-01T18:00:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', 'moderator', 110,  50, '2026-08-01T18:05:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', 'moderator',  80,   0, '2026-08-01T19:12:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', 'member',     30, -60, '2026-08-02T10:30:00Z'),
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'member',     90,   0, '2026-08-02T11:00:00Z'),
  -- u-06 Nina: 105 − 40. The stake on the PENDING duel b-08 left the moment she
  -- sent the challenge, while it can still be declined, expire, or be cascaded
  -- away by someone leaving. There is no escrow row holding it (D5) — the coins
  -- are simply gone until a void refunds them through app.settle_bet's ordinary
  -- refund branch.
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', 'member',     65,  25, '2026-08-03T14:45:00Z'),
  -- u-07 Guiz: 60 − 25, his own stake on the ACCEPTED duel b-07.
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000007', 'member',     35,   0, '2026-08-05T09:20:00Z'),
  -- u-08 Lelê: UNCHANGED at 65, and this is the row that proves the rule. He is
  -- b-08's challengee and has not accepted, so not one coin of his has moved.
  -- The symmetry of a duel's stake tempts you to debit both sides at once; do
  -- that and the guard reports 40 coins of drift against him on the next load.
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000008', 'member',     65,   0, '2026-08-07T21:10:00Z'),
  -- u-09 Pinto: 100 − 25, and his stake left on ACCEPT rather than at challenge
  -- time — D5's second movement, and why b-07 has a two-sided pool while b-08
  -- has a one-sided one.
  ('10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000009', 'member',     75,   0, '2026-08-10T16:40:00Z'),
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
--
-- No `kind` column in this list, deliberately: `bets.kind` is
-- `not null default 'pool'` (20260906130000_duel_schema.sql), and that default is
-- the entire reason Extra Phase 2 cost this schema no backfill — every row that
-- existed before duels did is a pool bet and says so without being told. The
-- fixture's TypeScript twin, packages/shared/src/mock-data.ts, has to spell
-- `kind: "pool"` out on all six of these because a TS object literal has no
-- default to inherit and `Bet.kind` is required; here the column supplies it.
-- The two DUEL bets are in their own section below and do name it explicitly,
-- because for them the default would be wrong.

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
-- The two duel pools (b-07 = 50, b-08 = 40) are written in the duel section
-- below instead, next to the bet_duels rows that explain their shape.

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

-- --- duels (Extra Phase 2) --------------------------------------------------------------
-- One ACCEPTED duel (b-07) and one PENDING one (b-08), mirroring mockDuels in
-- packages/shared/src/mock-data.ts. Four tables, because a duel is spread over
-- four: the `bets` row that makes it a bet at all, its two auto-generated
-- `bet_options`, the `bet_duels` row that makes it a duel, and the `wagers`
-- rows that are where the money actually went.
--
-- WHY THERE IS NO STATE CALLED "WAITING" ANYWHERE BELOW (D1/D2). A duel is a
-- `kind`, not a fourth `bet_state`. `bets.state` still admits exactly
-- open→closed→resolved and `enforce_bet_state_transition` — the one trigger in
-- this schema deliberately built with no service-context escape hatch — is
-- byte-for-byte unchanged by this phase. "Waiting to be accepted" is spelled
-- `kind='duel' and accepted_at is null and state='open'`, and the EXISTING
-- clock carries it: closes_at is the accept deadline, so UX-008's sort,
-- computeEffectiveState and the countdown all work with no special case.
-- Accepting then does exactly what close_bet_early already does — state='closed',
-- closes_at=now() — which is why b-07 below is 'closed' and not something new.
--
-- TIMESTAMPS: FIXED FOR THE ACCEPTED ONE, RELATIVE FOR THE PENDING ONE, and the
-- inconsistency is on purpose in a file whose whole point is determinism.
-- app.expire_stale_duels voids and refunds every duel with accepted_at is null
-- and closes_at <= now(), swept on team load and before every duel write (D8
-- half (b)). Seed b-08 with a hard-coded September date and the first person to
-- open the app after this seed goes stale gets a duel that voids itself before
-- they can look at it — no drift (the refund reconciles perfectly, which is
-- worse: nothing complains), just a "pending duel" fixture that has never once
-- been pending. `now()` is a transaction timestamp, so the three relative
-- values below are computed once and agree to the microsecond, and every
-- `supabase db reset` produces a challenge with 20 of its 24 hours left.
-- b-07 needs none of that: an accepted duel is invisible to the sweep, so its
-- dates are frozen like every other row here. mock-data.ts, which no running
-- code reads, keeps b-08 frozen too and argues the opposite side there.

insert into public.bets (id, team_id, creator_id, title, icon_emoji, kind, state, closes_at, max_wager_per_user, resolution_kind, winning_option_id, created_at) values
  -- b-07, ACCEPTED. closes_at is the ACCEPTANCE instant (D2), which is why it
  -- is EARLIER than the duel row's expires_at below rather than equal to it.
  -- max_wager_per_user = the stake: on a duel that is not a creator preference
  -- but the structural guarantee that a third wager is impossible even if a
  -- write path ever leaked (task 6). Two symmetric stakes are exactly what let
  -- app.settle_bet settle this with no duel-specific formula anywhere.
  ('20000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000007', '1v1 no FIFA: o Guiz passa o Pinto?',   '🕹️', 'duel', 'closed', '2026-09-04T20:30:00Z', 25, null, null, '2026-09-04T19:00:00Z'),
  -- b-08, PENDING. closes_at is the accept deadline itself — created_at plus
  -- CONFIG.DUEL_ACCEPT_WINDOW_HOURS / app.duel_accept_window(), to the
  -- microsecond, since both sides of the arithmetic read the same now().
  ('20000000-0000-4000-a000-000000000008', '10000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000006', '1v1 de sinuca no sábado: Nina ou Lelê?', '🎱', 'duel', 'open',   now() + interval '20 hours',  40, null, null, now() - interval '4 hours');

-- The two options are generated by create_duel from the participants'
-- display_name — position 0 = challenger, position 1 = challengee — and are not
-- the challenger's to choose. A duel has exactly two outcomes and they are the
-- two people in it, which is the other half of why settleBet needs nothing new.
insert into public.bet_options (id, bet_id, label, position) values
  ('30000000-0000-4000-a000-000000000701', '20000000-0000-4000-a000-000000000007', 'Guiz',  0),
  ('30000000-0000-4000-a000-000000000702', '20000000-0000-4000-a000-000000000007', 'Pinto', 1),
  ('30000000-0000-4000-a000-000000000801', '20000000-0000-4000-a000-000000000008', 'Nina',  0),
  ('30000000-0000-4000-a000-000000000802', '20000000-0000-4000-a000-000000000008', 'Lelê',  1);

-- The duel halves. Between them the two rows cover both resolver arms D7
-- allows, which is why there are two shapes here and not two of the same:
--
--   b-07 names a mediator (Pri, u-03) and leaves any_moderator false. Pri is a
--   moderator of t-01, but only incidentally — the named mediator may be ANY
--   teammate who is not one of the two participants, and no role is consulted
--   by app.can_resolve_duel's first arm. This row satisfies the left half of
--   bet_duels_has_a_resolver.
--
--   b-08 names nobody and sets any_moderator true — the pool arm, the CHECK's
--   right half, and the shape D9 forces onto every duel created inside a
--   `restricted` team. t-01 is free-for-all, so this one CHOSE it; it was not
--   coerced. There is deliberately no fixture for D9's coercion, because there
--   is nothing to fixture: it happens inside create_duel and the stored row is
--   identical either way. That IS D9's "enforced at creation, never
--   retroactively" — you cannot tell from a row which access mode produced it,
--   and no later read is supposed to be able to.
--
-- expires_at vs the bet's closes_at: EQUAL on b-08, still pending, where the
-- accept deadline is still the bet's deadline; DIVERGENT on b-07, where
-- accepting overwrote closes_at while expires_at kept the deadline the
-- challenge originally carried. That divergence is the entire reason the column
-- is stored rather than derived from the bet, and b-07 is here partly so a
-- reader can see it instead of taking the column comment's word for it.
insert into public.bet_duels (bet_id, challenger_id, challengee_id, mediator_id, any_moderator, stake, accepted_at, expires_at) values
  ('20000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000009', '00000000-0000-4000-a000-000000000003', false, 25, '2026-09-04T20:30:00Z', '2026-09-05T19:00:00Z'),
  ('20000000-0000-4000-a000-000000000008', '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000008', null,                                    true,  40, null,                   now() + interval '20 hours');

-- Where the coins actually went (D5). b-07's pool is 50 — 25 a side, and
-- structurally never more, because max_wager_per_user IS the stake; there is no
-- third wager to write and no path that could produce one, since place_wager
-- refuses kind='duel' outright and `wagers` INSERT has been revoked from
-- `authenticated` since Phase 6.
--
-- b-08's pool is 40. ONE row, and the asymmetry is the whole fixture: the
-- challengee's half does not exist until they accept. Adding a second row to
-- make it look tidy would put 40 coins into a pool that never left anybody's
-- balance, and the Phase 7 consistency guard would report it as drift against
-- u-08 the first time anyone loaded the team — the guard working, not the guard
-- being wrong.
--
-- Note the placed_at values on b-07: the challenger's is the bet's own
-- created_at, because create_duel writes the bet and the challenger's wager in
-- one transaction, and the challengee's is the acceptance instant. D5's two
-- movements, visible in the data.
insert into public.wagers (id, bet_id, option_id, user_id, amount, placed_at) values
  ('40000000-0000-4000-a000-000000000018', '20000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000701', '00000000-0000-4000-a000-000000000007', 25, '2026-09-04T19:00:00Z'),
  ('40000000-0000-4000-a000-000000000019', '20000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000702', '00000000-0000-4000-a000-000000000009', 25, '2026-09-04T20:30:00Z'),
  ('40000000-0000-4000-a000-000000000020', '20000000-0000-4000-a000-000000000008', '30000000-0000-4000-a000-000000000801', '00000000-0000-4000-a000-000000000006', 40, now() - interval '4 hours');


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

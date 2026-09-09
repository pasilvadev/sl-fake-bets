-- =============================================================================
-- SL Fake Bets — Data API privilege audit
-- Plan: agent-docs/plan-hosted-early-access.md Phase 1 task 10 / Phase 2 task 4.
--
-- HOW TO RUN
--   Paste this whole file into Studio's SQL editor (any project this schema
--   is applied to), or POST it as {"query": "<file contents>"} to
--   POST https://api.supabase.com/v1/projects/<ref>/database/query
--   (Authorization: Bearer $SUPABASE_ACCESS_TOKEN). Read-only: no writes, no
--   DDL, safe to run anytime, including against prod.
--
--   ZERO ROWS = PASS. Every row printed is one deviation, columns:
--     kind       'table' | 'function' | 'rls'
--     object     schema-qualified table, or schema.name(args) for a function
--     role       'anon' | 'authenticated' | null (rls rows)
--     privilege  select/insert/update/delete, execute, or an rls check name
--     expected   what the migrations, read in file order, end up producing
--     actual     what has_table_privilege/has_function_privilege/pg_catalog
--                reports right now
--     note       which migration sets the expectation, or what's wrong
--
-- HOW "expected" WAS DERIVED — READ BEFORE EDITING
--   Every table and function below starts EXPECTED = true for BOTH anon and
--   authenticated, for every verb (select/insert/update/delete, or execute).
--   That is not a permissive assumption — it is the VERIFIED baseline this
--   project's Data API roles actually carry: a fresh object in `public` (and,
--   for functions only, `app`) gets anon/authenticated/service_role granted
--   BY NAME at create time, and "revoke ... from public" alone does NOT
--   strip that named grant (public.chat_page's and app.prune_chat_messages's
--   own migration comments in 20260906120000_team_chat.sql document exactly
--   this, and 20260906130400_duel_pair_rule_fix.sql's header re-confirms it
--   for five more functions with a direct has_function_privilege check run
--   before that migration was written). This audit re-verified all ~260
--   privilege/RLS cells below against the qkwvmdshqnkfqekilipo project on
--   2026-09-07 before writing them down — see the exceptions lists, which are
--   the ONLY cells where a migration's own explicit, ROLE-NAMED revoke moves
--   a cell from the true default to false. A `revoke ... from public` with no
--   named role is not such a revoke and is not listed.
--
--   Function overloads: identified by (schema, name, exact identity argument
--   list) — `resolve_bet`'s original 3-arg form was DROPPED by
--   20260906130100_duel_rpcs.sql:1105 and only the 4-arg replacement is in
--   the roster below.
--
-- Migration file key used in the comments below:
--   dom = 20260905120000_domain_schema.sql      ah  = 20260905120200_auth_helpers.sql
--   di  = 20260905120300_domain_invariants.sql   rls = 20260905120400_rls_policies.sql
--   apb = 20260905130000_auth_profile_bootstrap.sql
--   trp = 20260905140000_team_rpcs.sql           brp = 20260905150000_bet_rpcs.sql
--   dbo = 20260905160000_delete_bet_may_overdraw.sql
--   rrl = 20260905170000_resolution_rewards_ledger.sql
--   ops = 20260905180000_onboarding_profile_step.sql
--   shp = 20260905200000_share_previews.sql      cht = 20260906120000_team_chat.sql
--   dsc = 20260906130000_duel_schema.sql          drp = 20260906130100_duel_rpcs.sql
--   dpf = 20260906130400_duel_pair_rule_fix.sql
--   inv = 20260907150000_invite_links.sql
--   wrk = 20260909100000_weekly_reward_kind.sql    lrr = 20260909100100_login_rewards_retune.sql
-- =============================================================================

with roster_tables(object) as ( -- dom: domain tables; cht/dsc: the two later ones
  values ('users'),('teams'),('team_members'),('team_bans'),('invite_codes'),
         ('bets'),('bet_options'),('wagers'),('transactions'),('comments'),
         ('analytics_events'),('feature_flags'),('chat_messages'),('bet_duels')
),
roles(role) as (values ('anon'), ('authenticated')),
privs(priv) as (values ('select'),('insert'),('update'),('delete')),

-- Every cell NOT listed here is expected TRUE (see header). Each row is a
-- migration's explicit, role-named REVOKE that never gets re-granted after.
table_exceptions(object, role, priv, note) as (values
  ('teams','authenticated','insert','trp: create_team owns team+founding-membership atomically'),
  ('team_members','authenticated','insert','trp: create_team/join_team_with_code own it'),
  ('team_members','authenticated','delete','trp: remove_membership owns the wager cascade'),
  ('team_bans','authenticated','insert','trp: remove_membership owns ban+kick together'),
  ('transactions','authenticated','insert','trp: app.apply_transaction is the only ledger writer'),
  ('transactions','authenticated','update','rls: DOM-025 append-only ledger'),
  ('transactions','authenticated','delete','rls: DOM-025 append-only ledger'),
  ('transactions','anon','update','rls: DOM-025 append-only ledger'),
  ('transactions','anon','delete','rls: DOM-025 append-only ledger'),
  ('bets','authenticated','insert','brp: create_bet owns the two-option floor'),
  ('bets','authenticated','update','brp: close_bet_early/resolve_bet own paired columns'),
  ('bets','authenticated','delete','brp: delete_bet owns the money reversal'),
  ('bet_options','authenticated','insert','brp: create_bet is the only writer'),
  ('bet_options','authenticated','update','brp: options never change after creation'),
  ('bet_options','authenticated','delete','brp: options die only with their bet'),
  ('wagers','authenticated','insert','brp: place_wager owns the balance debit'),
  ('wagers','authenticated','delete','brp: remove_membership/delete_bet own the cascade'),
  ('chat_messages','authenticated','update','cht: chat is append-only, no edit history'),
  ('chat_messages','anon','update','cht: belt-and-braces, same inherited-default correction'),
  ('bet_duels','authenticated','insert','dsc: create_duel is the only writer'),
  ('bet_duels','authenticated','update','dsc: accept_duel/void_duel own every transition'),
  ('bet_duels','authenticated','delete','dsc: a duel dies only via its bet, by cascade'),
  ('bet_duels','anon','insert','dsc: belt-and-braces, same inherited-default correction'),
  ('bet_duels','anon','update','dsc: belt-and-braces, same inherited-default correction'),
  ('bet_duels','anon','delete','dsc: belt-and-braces, same inherited-default correction'),
  ('invite_codes','authenticated','insert','inv: create_invite_code/revoke_invite_code own every write'),
  ('invite_codes','authenticated','update','inv: create_invite_code/revoke_invite_code own every write'),
  ('invite_codes','authenticated','delete','inv: create_invite_code/revoke_invite_code own every write'),
  ('invite_codes','anon','insert','inv: create_invite_code/revoke_invite_code own every write'),
  ('invite_codes','anon','update','inv: create_invite_code/revoke_invite_code own every write'),
  ('invite_codes','anon','delete','inv: create_invite_code/revoke_invite_code own every write')
),

-- ah: 13 permission-mirror helpers. di: 5 invariant triggers. inf: set_updated_at.
-- apb: 4 signup-prefill helpers. trp: 9 team/ledger RPCs+helpers. brp: settlement
-- twins + 4 bet RPCs. dbo: the overdraw trigger. rrl: 2 reward/resolution helpers.
-- ops: profile_prefill_kind. shp: bet_preview. cht: 4 chat helpers/RPC/trigger.
-- drp: 12 duel helpers/RPCs/void-path. dpf: enforce_duel_pending_cap (recreated).
-- inv: 2 tunables + create_invite_code/revoke_invite_code (team_preview_by_code
-- and join_team_with_code are recreated with the same signatures, so they stay
-- on their trp roster row unmoved).
-- lrr: weekly_reward_coins + claim_weekly_reward (daily_reward_coins is
-- recreated with the same signature, stays on its rrl row).
roster_functions(schema, name, args) as (values
  ('app','apply_transaction','p_team_id uuid, p_user_id uuid, p_kind transaction_kind, p_amount integer, p_description text'),
  ('app','bet_accepts_wagers','p_bet_id uuid'),
  ('app','bet_team_id','p_bet_id uuid'),
  ('app','can_create_bet','p_team_id uuid'),
  ('app','can_manage_bet','p_bet_id uuid'),
  ('app','can_resolve_bet','p_bet_id uuid'),
  ('app','can_resolve_duel','p_bet_id uuid'),
  ('app','chat_retention_interval',''),
  ('app','daily_reward_coins',''),
  ('app','default_avatar','p_meta jsonb'),
  ('app','default_display_name','p_email text, p_meta jsonb'),
  ('app','default_name_color',''),
  ('app','duel_accept_window',''),
  ('app','duel_max_pending_per_challenger',''),
  ('app','expire_stale_duels','p_team_id uuid'),
  ('app','handle_new_user',''),
  ('app','invite_max_live_temporary_per_team',''),
  ('app','invite_temporary_ttl',''),
  ('app','is_banned','p_team_id uuid, p_user_id uuid'),
  ('app','is_bet_team_member','p_bet_id uuid'),
  ('app','is_duel_participant','p_bet_id uuid'),
  ('app','is_moderator_or_leader','p_team_id uuid'),
  ('app','is_service_context',''),
  ('app','is_team_leader','p_team_id uuid'),
  ('app','is_team_member','p_team_id uuid'),
  ('app','onboarding_grant_coins',''),
  ('app','profile_prefill_kind','p_meta jsonb'),
  ('app','prune_chat_messages',''),
  ('app','require_uid',''),
  ('app','reverse_bet_effects','p_bet_id uuid'),
  ('app','seed_membership','p_team_id uuid, p_user_id uuid'),
  ('app','settle_bet','p_bet_id uuid, p_kind bet_resolution_kind, p_winning_option_id uuid'),
  ('app','shares_team_with','p_user_id uuid'),
  ('app','team_leader_id','p_team_id uuid'),
  ('app','team_role','p_team_id uuid'),
  ('app','void_duel','p_bet_id uuid, p_reason bet_void_reason'),
  ('app','void_duels_for_departing_member','p_team_id uuid, p_user_id uuid'),
  ('app','weekly_reward_coins',''),
  ('public','accept_duel','p_bet_id uuid'),
  ('public','bet_preview','p_bet_id uuid'),
  ('public','chat_page','p_team_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer'),
  ('public','claim_daily_reward','p_team_id uuid'),
  ('public','claim_weekly_reward','p_team_id uuid'),
  ('public','close_bet_early','p_bet_id uuid'),
  ('public','create_bet','p_team_id uuid, p_title text, p_icon_emoji text, p_options text[], p_closes_at timestamp with time zone, p_max_wager_per_user integer'),
  ('public','create_duel','p_team_id uuid, p_title text, p_icon_emoji text, p_challengee_id uuid, p_mediator_id uuid, p_any_moderator boolean, p_stake integer'),
  ('public','create_invite_code','p_team_id uuid, p_code text, p_temporary boolean'),
  ('public','create_team','p_name text, p_access_mode team_access_mode, p_invite_code text'),
  ('public','decline_duel','p_bet_id uuid, p_reason bet_void_reason'),
  ('public','delete_bet','p_bet_id uuid'),
  ('public','enforce_bet_state_transition',''),
  ('public','enforce_chat_flood_control',''),
  ('public','enforce_duel_pending_cap',''),
  ('public','enforce_leader_id_immutable',''),
  ('public','enforce_leader_is_member',''),
  ('public','enforce_leader_membership_kept',''),
  ('public','enforce_non_negative_balance',''),
  ('public','enforce_team_member_update_rules',''),
  ('public','inject_coins','p_team_id uuid, p_user_id uuid, p_amount integer'),
  ('public','join_team_with_code','p_code text'),
  ('public','place_wager','p_bet_id uuid, p_option_id uuid, p_amount integer'),
  ('public','remove_membership','p_team_id uuid, p_user_id uuid, p_ban boolean, p_wager_ids uuid[]'),
  ('public','resolve_bet','p_bet_id uuid, p_kind bet_resolution_kind, p_winning_option_id uuid, p_void_reason bet_void_reason'),
  ('public','revoke_invite_code','p_invite_id uuid'),
  ('public','set_updated_at',''),
  ('public','sweep_stale_duels',''),
  ('public','team_preview_by_code','p_code text')
),

-- Cells not listed here are expected TRUE. cht's app.prune_chat_messages row is
-- deliberately NOT a false-for-both grouping with the drp/dpf rows below: it is
-- revoked in cht, then SILENTLY RE-GRANTED by drp's later
-- `grant execute on all functions in schema app to authenticated, anon`
-- (20260906130100_duel_rpcs.sql:1761), which runs after cht and is never
-- followed by a corrective re-revoke naming this function. Expected stays
-- false (matching cht's explicit, extensively-argued intent); flagged below.
function_exceptions(schema, name, args, role, note) as (values
  ('public','chat_page','p_team_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer','anon','cht: no unauthenticated audience for chat'),
  ('app','prune_chat_messages','','anon','cht: SECURITY DEFINER, deletes across every team — see note above'),
  ('app','prune_chat_messages','','authenticated','cht: SECURITY DEFINER, deletes across every team — see note above'),
  ('app','void_duel','p_bet_id uuid, p_reason bet_void_reason','anon','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('app','void_duel','p_bet_id uuid, p_reason bet_void_reason','authenticated','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('app','expire_stale_duels','p_team_id uuid','anon','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('app','expire_stale_duels','p_team_id uuid','authenticated','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('app','void_duels_for_departing_member','p_team_id uuid, p_user_id uuid','anon','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('app','void_duels_for_departing_member','p_team_id uuid, p_user_id uuid','authenticated','drp: SECURITY DEFINER, voids any bet and moves balances'),
  ('public','create_duel','p_team_id uuid, p_title text, p_icon_emoji text, p_challengee_id uuid, p_mediator_id uuid, p_any_moderator boolean, p_stake integer','anon','dpf: anon named explicitly (from-public alone is not enough)'),
  ('public','accept_duel','p_bet_id uuid','anon','dpf: anon named explicitly (from-public alone is not enough)'),
  ('public','decline_duel','p_bet_id uuid, p_reason bet_void_reason','anon','dpf: anon named explicitly (from-public alone is not enough)'),
  ('public','sweep_stale_duels','','anon','dpf: anon named explicitly (from-public alone is not enough)'),
  ('public','resolve_bet','p_bet_id uuid, p_kind bet_resolution_kind, p_winning_option_id uuid, p_void_reason bet_void_reason','anon','dpf: anon named explicitly (from-public alone is not enough)'),
  ('public','create_invite_code','p_team_id uuid, p_code text, p_temporary boolean','anon','inv: anon named explicitly (from-public alone is not enough)'),
  ('public','revoke_invite_code','p_invite_id uuid','anon','inv: anon named explicitly (from-public alone is not enough)'),
  ('public','claim_weekly_reward','p_team_id uuid','anon','lrr: anon named explicitly (from-public alone is not enough)')
),

live_tables as (
  select c.oid, c.relname as object, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
live_functions as (
  select p.oid, n.nspname as schema, p.proname as name,
         pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app')
),

table_rows as (
  select 'table'::text as kind,
         'public.'||coalesce(rt.object, lt.object) as object,
         r.role, p.priv,
         (rt.object is not null
           and not exists (select 1 from table_exceptions te
                            where te.object = rt.object and te.role = r.role and te.priv = p.priv)
         )::text as expected,
         case when lt.oid is null then 'MISSING'
              when p.priv = 'select' then has_table_privilege(r.role, lt.oid, 'SELECT')::text
              when p.priv = 'insert' then has_table_privilege(r.role, lt.oid, 'INSERT')::text
              when p.priv = 'update' then has_table_privilege(r.role, lt.oid, 'UPDATE')::text
              else has_table_privilege(r.role, lt.oid, 'DELETE')::text end as actual,
         case when rt.object is null then 'present in schema but not in the expected roster above'
              when lt.oid is null then 'expected table is missing from the schema'
              else (select note from table_exceptions te
                    where te.object = rt.object and te.role = r.role and te.priv = p.priv)
         end as note
  from roster_tables rt
  full outer join live_tables lt on lt.object = rt.object
  cross join roles r cross join privs p
),
function_rows as (
  select 'function'::text as kind,
         rf.schema||'.'||coalesce(rf.name, lf.name)||'('||coalesce(rf.args, lf.args)||')' as object,
         r.role, 'execute' as priv,
         (rf.name is not null
           and not exists (select 1 from function_exceptions fe
                            where fe.schema = rf.schema and fe.name = rf.name
                              and fe.args = rf.args and fe.role = r.role)
         )::text as expected,
         case when lf.oid is null then 'MISSING'
              else has_function_privilege(r.role, lf.oid, 'EXECUTE')::text end as actual,
         case when rf.name is null then 'present in schema but not in the expected roster above'
              when lf.oid is null then 'expected function is missing from the schema'
              else (select note from function_exceptions fe
                    where fe.schema = rf.schema and fe.name = rf.name
                      and fe.args = rf.args and fe.role = r.role)
         end as note
  from roster_functions rf
  full outer join live_functions lf on lf.schema = rf.schema and lf.name = rf.name and lf.args = rf.args
  cross join roles r
),
rls_rows as (
  select 'rls'::text as kind, 'public.'||rt.object as object, null::text as role,
         'row_level_security' as priv, 'true' as expected,
         coalesce(lt.relrowsecurity::text, 'MISSING') as actual,
         'RLS must be enabled on every domain/infra table (20260905120400_rls_policies.sql, cht, dsc)' as note
    from roster_tables rt left join live_tables lt on lt.object = rt.object
   where lt.relrowsecurity is distinct from true
  union all
  select 'rls', 'public.'||rt.object, null, 'policy_count', '>=1',
         (select count(*)::text from pg_policy pol where pol.polrelid = lt.oid),
         'RLS is enabled with zero policies — every role is locked out of every row (functionality gap, not a hole)'
    from roster_tables rt join live_tables lt on lt.object = rt.object
   where lt.relrowsecurity
     and not exists (select 1 from pg_policy pol where pol.polrelid = lt.oid)
)
select kind, object, role, priv as privilege, expected, actual, note
  from table_rows where expected is distinct from actual
union all
select kind, object, role, priv, expected, actual, note
  from function_rows where expected is distinct from actual
union all
select kind, object, role, priv, expected, actual, note
  from rls_rows
order by kind, object, role, privilege;

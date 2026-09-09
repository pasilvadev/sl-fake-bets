-- =============================================================================
-- SL Fake Bets — `app.seed_membership` writes a truthful INSERT payload
-- (post-launch bug fix, `agent-docs/found-bugs.md` "Negative balances on
-- teammates' dashboards", step 5 of that entry's plan).
--
-- THE BUG THIS CLOSES OFF
--
--   `app.seed_membership` (`20260905140000_team_rpcs.sql`, unchanged since —
--   still the function `create_team` and `join_team_with_code` both call)
--   inserted the `team_members` row with `coin_balance = 0` and only THEN
--   credited the onboarding grant through `app.apply_transaction`, a second,
--   separate UPDATE. Two statements, two logical-decoding events. The
--   realtime `team_members` INSERT binding
--   (`20260908120000_team_members_realtime.sql`,
--   `apps/web/src/lib/data/realtime.ts`'s `subscribeTeamChannel`) delivers
--   the FIRST one, and every observer's dashboard mapped it verbatim — a
--   brand-new member arriving at a **0** balance that was never true for
--   longer than the gap between two statements in one transaction, and
--   every wager they placed afterwards was computed against that phantom 0.
--
--   The other post-launch fix in the same `found-bugs.md` entry (client-side:
--   `apps/web/src/lib/data/realtime.ts` + `team-context.tsx`'s `member-update`
--   reducer case) makes every OTHER write path server-authoritative on every
--   open tab, which is what stops this from being a display-only glitch for
--   observers. This migration is the fix for the specific write path that
--   made the very first row a lie in the first place — independent of that
--   client-side fix and worth shipping even alone.
--
-- THE FIX
--
--   Insert with `coin_balance` already at the grant, and write the
--   `transactions` row directly instead of going through
--   `app.apply_transaction` — that function's whole job is to READ the
--   CURRENT balance and increment it, which is exactly the wrong tool once
--   the INSERT already carries the final number; calling it here would still
--   be a second statement doing an UPDATE this INSERT no longer needs.
--
--   Nothing downstream objects:
--     * `enforce_team_member_update_rules` (`20260905170000_...`) is
--       `before UPDATE` only — an INSERT never reaches it.
--     * `enforce_non_negative_balance` (`20260905160000_...`) is `before
--       insert or update`, but a positive `coin_balance` on INSERT passes its
--       `new.coin_balance >= 0` branch trivially — nothing here is the
--       sanctioned-overdraw path that trigger exists for.
--     * The one-grant-per-membership invariant is structural, not a
--       constraint (`20260905140000_team_rpcs.sql`'s closing comment — the
--       partial unique index it once was is long dropped): the
--       `team_members` INSERT still runs first and still fails on the
--       `(team_id, user_id)` primary key before a second grant's
--       `transactions` row could ever be written for the same membership.
--
--   The result: the INSERT payload every subscriber receives is truthful on
--   its own, independent of whether the client-side fix above has also
--   shipped — a joiner's balance is never observably 0 for even one event.
-- =============================================================================

create or replace function app.seed_membership(p_team_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_grant integer := app.onboarding_grant_coins();
begin
  insert into public.team_members (team_id, user_id, role, coin_balance, profit_loss)
  values (p_team_id, p_user_id, 'member', v_grant, 0);

  -- Not `app.apply_transaction`: that function re-reads `coin_balance` and
  -- adds to it, which only makes sense once a row already exists at some
  -- OTHER value. Here the INSERT above already wrote the final number, so
  -- this is a plain snapshot of it — `balance_after = v_grant` by construction.
  insert into public.transactions (team_id, user_id, kind, amount, description, balance_after)
  values (p_team_id, p_user_id, 'onboarding-grant', v_grant, 'Onboarding grant', v_grant);
end;
$$;

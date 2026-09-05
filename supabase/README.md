# supabase/

Local backend for SL Fake Bets: 100% on the developer's machine via the Supabase
CLI + Docker (vision Phase 2, ARC-011). Nothing here is deployed anywhere — the
hosted transition is vision Phase 3 (ARC-012) and needs its own explicit owner
order under ARC-013, exactly like this one did.

## Running it

```bash
supabase start      # boots the stack (Docker must be running)
supabase db reset   # re-applies every migration, then re-seeds
supabase status     # URLs and keys
supabase stop       # tears the stack down, keeping the database
```

Run them **from the project root**: the CLI locates the stack by reading
`config.toml` and derives the project id from the folder name, which is why every
container is named `supabase_*_sl-fake-bets`. The CLI is installed globally
(`/usr/local/bin/supabase`), so no `npx` is needed.

**Runbook (start/stop, the destructive flag, ports, a normal session):**
<https://claude.ai/code/artifact/f1ca0d3b-957b-474a-b292-a3fc87428a78>

| Service | URL |
|---|---|
| API / PostgREST | http://127.0.0.1:54321 |
| Postgres | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio | http://127.0.0.1:54323 |
| Mailpit (all outgoing email) | http://127.0.0.1:54324 |

## Layout

| Path | What it holds |
|---|---|
| `migrations/20260905120000_domain_schema.sql` | Domain tables, mirroring `packages/shared/src/types.ts` |
| `migrations/20260905120100_infra_tables.sql` | `analytics_events` (ARC-017), `feature_flags` (ARC-016) |
| `migrations/20260905120200_auth_helpers.sql` | Private `app` schema — the SQL mirror of `permissions.ts` |
| `migrations/20260905120300_domain_invariants.sql` | Triggers for rules a CHECK cannot express (DOM-001, DOM-012, DOM-024) |
| `migrations/20260905120400_rls_policies.sql` | Row Level Security for every table |
| `migrations/20260905120500_storage_avatars.sql` | Avatars bucket + per-user folder policies (UX-022) |
| `migrations/20260905130000_auth_profile_bootstrap.sql` | Phase 4: pre-filled `public.users` row for every new auth identity (UX-002) |
| `migrations/20260905140000_team_rpcs.sql` | Phase 5: team/membership RPCs — create, join by code, kick/ban cascade, `inject_coins` |
| `migrations/20260905150000_bet_rpcs.sql` | Phase 6: `create_bet`, `place_wager`, `close_bet_early`, `delete_bet`; withdraws the direct client writes those replace |
| `migrations/20260905160000_delete_bet_may_overdraw.sql` | Owner ruling: deleting a RESOLVED bet claws its payout back and may overdraw (the one negative-balance exception) |
| `migrations/20260905170000_resolution_rewards_ledger.sql` | Phase 7: `resolve_bet`, `claim_daily_reward`, and the non-negative-balance trigger |
| `seed.sql` | `mock-data.ts` as Postgres rows; re-runs on every `db reset` |
| `templates/magic_link.html` | Why email login is a CODE, not a link (decision §4.1) |
| `.env` | Google OAuth dev credentials. Gitignored — never commit |

## Things that will bite you

- **`seed.sql` is one transaction, deliberately.** Two deferred constraints need
  it: the DOM-001 leader-is-a-member trigger and the `bets`→`bet_options`
  winning-option foreign key. Splitting it into per-statement autocommits breaks
  both.
- **Triggers that gate writes must NOT be `SECURITY DEFINER`.** Inside a definer
  function `current_user` is `postgres`, so `app.is_service_context()` returns
  true and the trigger disarms itself for every caller. This silently let a
  moderator inject coins (DOM-024) until it was caught by the phase's own exit
  check. (`on_auth_user_created` IS a definer, correctly: it gates nothing, and
  the role inserting during signup is GoTrue's `supabase_auth_admin`, which has
  no rights on `public.users`.)
- **`seed.sql`'s profile insert is an UPSERT**, and must stay one. Since Phase 4
  the `on_auth_user_created` trigger writes a randomly pre-filled profile the
  moment the seed inserts each `auth.users` row; the fixture values overwrite
  those. A plain insert fails with a unique violation.
- **No email ever leaves this machine.** Mailpit (http://127.0.0.1:54324)
  captures every outgoing message, so signing in with a real address and
  waiting for an OTP in a real inbox will wait forever. The OTP screen says so
  in dev. This is a property of the local stack, not a bug.
- **Seeded accounts** are `<name>@sl.local` (rafa, duds, pri, tomate, careca,
  nina, guiz, lele, pinto, xis), password `slfakebets`. Dev only. The product's
  real email flavor is OTP; the password exists so you can jump straight into a
  specific member's session while testing policies.
- **`supabase stop --no-backup` deletes the database volume** — teams, bets and
  your own OAuth account. Plain `supabase stop` keeps everything (`backup: true`
  is the default); `supabase db reset` wipes and re-seeds by design. After any
  wipe, a live browser session points at a `public.users` row that no longer
  exists and team creation fails on `teams_leader_id_fkey` until you sign in
  again.
- **Don't stop the containers one at a time in Docker Desktop.** `kong` and
  `vector` have restart policies and the rest have dependent healthchecks, so
  stopping `db` alone makes half the stack thrash and restart. `supabase stop`
  goes down in dependency order; the Docker-native equivalent is
  `docker stop $(docker ps -q --filter name=sl-fake-bets)`.
- **Google OAuth** needs `supabase/.env` present. Regenerate it from the
  `client_secret_*.json` in the repo root if it goes missing.

## State of the backend

Roadmap **Phases 3–7 are done**, and every money path now lives in Postgres as a
`SECURITY DEFINER` RPC — nothing mutates coins from the client any more:

| Path | RPC |
|---|---|
| Teams & membership | `create_team`, `team_preview_by_code`, `join_team_with_code`, `remove_membership` (kick/ban + wager cascade), `inject_coins` |
| Bets & wagers | `create_bet`, `place_wager`, `close_bet_early`, `delete_bet` |
| Money out | `resolve_bet`, `claim_daily_reward` |

RLS is therefore no longer the Phase 3 first pass on the write side. Phases 5–6
dropped the direct write policies and **revoked** the grants behind them from
`authenticated` — all three writes on `bets` and `bet_options`, insert+delete on
`wagers`, `team_members` and (insert only) `teams`, `team_bans`, `transactions` —
because leaving a policy beside the RPC that replaced it would have been a
second, weaker path to the same rows. SELECT policies are still Phase 3's,
deliberately: membership-scoped reads are what `loadTeamData` relies on.

**Still not built:**

- **Realtime (Phase 8).** No subscriptions exist; `apps/web` refetches on its own
  after each mutation, so a teammate's new bet or wager needs a refresh.
- **Analytics & flags (Phase 9).** `analytics_events` and `feature_flags` exist
  and are empty — nothing reads or writes either table yet.
- **The onboarding step (Phase 7.5).** Specced in the roadmap, not migrated:
  `users.onboarded_at` and `users.profile_prefill` do not exist yet.
- **Hosted anything (ARC-012).** Still gated by ARC-013 and outside the roadmap.

**Known unverified:** Phase 7's exit criteria were proven at the database and
PostgREST layers, but the two-real-accounts browser walkthrough — two signed-in
users resolving a bet in the UI and balances surviving a restart — has never been
driven. Worth doing before Phase 8 builds realtime on top of those write paths.

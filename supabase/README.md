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
| `migrations/20260905180000_onboarding_profile_step.sql` | Phase 7.5: `users.onboarded_at` / `users.profile_prefill`, the signup trigger that sets the prefill kind, and a backfill so existing accounts skip the first-run step |
| `migrations/20260905190000_realtime_publication.sql` | Phase 8: adds `bets`, `wagers`, `comments` to the `supabase_realtime` publication — and nothing else |
| `migrations/20260905200000_share_previews.sql` | Phase 9: `bet_preview` (UX-024 social cards), plus the `coming-soon-teasers` flag that gives ARC-016 a live reader |
| `queries/arc-017-metrics.sql` | The two ARC-017 metrics, as SQL. This is the entire analytics product — run it in Studio; there is no dashboard |
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
- **The fixtures are stamped as already onboarded** (`seed.sql`, Phase 7.5), so
  signing in as Rafa lands on the dashboard rather than on the first-run profile
  step. To see that step, sign up a fresh account — a brand-new identity is the
  only case it exists for, and every existing row was backfilled by its
  migration.
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

Roadmap **Phases 3–9 are done** — the local-MVP checkpoint. Every money path
lives in Postgres as a `SECURITY DEFINER` RPC; nothing mutates coins from the
client:

| Path | RPC |
|---|---|
| Teams & membership | `create_team`, `team_preview_by_code`, `join_team_with_code`, `remove_membership` (kick/ban + wager cascade), `inject_coins` |
| Bets & wagers | `create_bet`, `place_wager`, `close_bet_early`, `delete_bet` |
| Money out | `resolve_bet`, `claim_daily_reward` |
| Share previews (no session needed) | `team_preview_by_code` (UX-023), `bet_preview` (UX-024) |

RLS is therefore no longer the Phase 3 first pass on the write side. Phases 5–6
dropped the direct write policies and **revoked** the grants behind them from
`authenticated` — all three writes on `bets` and `bet_options`, insert+delete on
`wagers`, `team_members` and (insert only) `teams`, `team_bans`, `transactions` —
because leaving a policy beside the RPC that replaced it would have been a
second, weaker path to the same rows. SELECT policies are still Phase 3's,
deliberately: membership-scoped reads are what `loadTeamData` relies on.

**Two functions are readable with no session at all, on purpose.**
`team_preview_by_code` and `bet_preview` are granted to `anon` because their
audience is a link unwrapper — Slack's, WhatsApp's, Twitter's — which carries no
cookie. Holding the invite code or the bet id IS the authorization, and both
return only what a preview card shows: no balances, no wagerer identities, no
comments. Anything added to either function is published to whoever holds the
link.

**Realtime (Phase 8):** the publication carries `bets`, `wagers` and `comments`
and must keep carrying only those — `team_members` and `transactions` would cost
~450 messages per bet resolution and re-apply money the acting client already
moved. Replica identity stays at the default. `agent-docs/design-realtime.md` §5
is the binding rule set.

**Analytics & flags (Phase 9):** both infra tables now have exactly one writer
and one reader each.

- `analytics_events` is written by `apps/web/src/lib/analytics.ts` and by nothing
  else, with exactly two event families (ARC-017's cap, enforced by the
  `ANALYTICS_EVENTS` constant in `packages/shared/src/infra.ts`). It has **no
  SELECT policy for anyone** — reading is a Studio/`service_role` action, which
  is what keeps a reporting surface from growing inside the app. The queries live
  in `queries/arc-017-metrics.sql` and count DISTINCT actors, never rows.
- `feature_flags` is read once per request by the root layout and handed to the
  tree (`apps/web/src/lib/feature-flags.tsx`). Toggling a row in Studio changes
  the app on the next load — verified by flipping `coming-soon-teasers` and
  watching the chat teaser leave and return. Writes are `service_role` only, by
  design: Studio IS the admin UI.

**Still not built:** hosted anything (ARC-012) — gated by ARC-013 and outside the
roadmap. That is the only `[mvp]` item left.

**Verification note for agents.** Real local sessions need no owner accounts:
`auth.admin.createUser({ email_confirm: true })` with the `SERVICE_ROLE_KEY`
mints them outright, the genuine OTP path is drivable by calling
`signInWithOtp` and reading the code from Mailpit
(`http://127.0.0.1:54324/api/v1/search?query=to:…`), and the seeded fixtures all
share the local dev password `slfakebets`, which the `token?grant_type=password`
endpoint will exchange for a session without sending mail at all — the way to
drive a signed-in browser without spending the OTP rate limit. Phase 9 drove
headless Chrome over CDP directly (no Playwright/Puppeteer in this repo); Google
OAuth remains the one flow that cannot be automated.

**`[auth.rate_limit] email_sent = 2`** in `config.toml` is per hour and
project-wide. A script that signs up a third account in the same hour silently
receives no mail and looks like a broken auth page.

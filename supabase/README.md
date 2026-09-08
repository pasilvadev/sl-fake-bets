# supabase/

Backend for SL Fake Bets: Supabase, hosted since 2026-09-07 (vision Phase 3,
ARC-012 — `agent-docs/plan-hosted-early-access.md`) and still runnable 100%
locally via the CLI + Docker if that's ever needed again (appendix, below).
The owner's daily driver is hosted dev, Docker-free; nothing here is deployed
by hand — `db push` and `config push` are the deploy.

## Hosted

Two Supabase Cloud free projects in one org, plus one Vercel Hobby project:

| Project | Ref | Role |
|---|---|---|
| `sl-fake-bets-dev` | `qkwvmdshqnkfqekilipo` | The owner's `next dev` target, the Vercel Preview/Development environment, and the agents' verification target. Allowed to idle-pause (7 days) — it is *not* covered by the keep-alive cron, on purpose. |
| `sl-fake-bets` | `pgupqbizlfundbvxixvs` | Production. Friends sign themselves up at `https://sl-fake-bets.vercel.app`. Kept alive by a daily Vercel cron. |

Both `sa-east-1`, both Nano compute. One Vercel project, `sl-fake-bets`
(Hobby, team slug `sl-3407`), whose **Production** environment points at prod
and whose **Preview**/**Development** environments point at dev.

| Where | URL |
|---|---|
| Production app | <https://sl-fake-bets.vercel.app> |
| Dev Studio | <https://supabase.com/dashboard/project/qkwvmdshqnkfqekilipo> |
| Prod Studio | <https://supabase.com/dashboard/project/pgupqbizlfundbvxixvs> |
| Vercel project | <https://vercel.com/sl-3407/sl-fake-bets> |

### The CLI is linked to dev, forever

`supabase/.temp/project-ref` holds dev's ref, so every **bare** `supabase db
push`, `db reset`, `config push` and `migration list` lands on dev by
construction — including the ones you'd type from habit. **Never run
`supabase link --project-ref <prod-ref>`.** If the repo is ever found linked
to prod, re-link to dev before doing anything else: both prod scripts below
refuse to run while linked to prod, precisely because it would mean every
*other* bare command in this repo had quietly started pointing at prod too.

### The six scripts, and which one you want

| `pnpm` script | Runs | Lands on |
|---|---|---|
| `db:push:dev` | `supabase db push --linked` | dev |
| `db:reset:dev` | `supabase db reset --linked` | dev — **wipes and re-seeds** |
| `db:status` | `supabase migration list --linked` | dev (read-only) |
| `config:push:dev` | `supabase config push` | dev |
| `db:push:prod` | `scripts/db-push-prod.sh` | prod, guarded — below |
| `config:push:prod` | `scripts/config-push-prod.sh` | prod, guarded — below |

### Why the CLI's own prompt cannot be trusted

`db reset`'s confirmation is `Confirm resetting the remote database? [Y/n]` —
it does not name the project it is about to erase (Supabase CLI issues
#33399, #3910, #1326: "can corrupt data in production"). Nothing here may
ever rely on a person reading that prompt correctly under time pressure, so
prod is reached through exactly two scripts and nothing else:

- **`pnpm db:push:prod`** (`scripts/db-push-prod.sh`) refuses to run unless
  `SUPABASE_PROD_PROJECT_REF` and `SUPABASE_PROD_DB_PASSWORD` are set in
  `.env.ops`, refuses if the repo is currently linked to prod, prints the
  target ref, runs `supabase db push --project-ref … --dry-run` and shows
  exactly what would apply, then requires the word **`prod`** typed at a
  prompt it renders itself — not `y`, not Enter — before the real push runs.
  Prod is never `db reset`: schema changes reach it only as forward
  migrations. **No script, alias or doc in this repo may ever put a prod ref
  or a prod connection string next to `db reset` or `--include-seed`** — this
  script contains neither token, on purpose, and never should.
- **`pnpm config:push:prod`** (`scripts/config-push-prod.sh`) exists because
  a bare `supabase config push --project-ref <prod-ref>` is **wrong** for
  this org: `config.toml`'s `[remotes.production]` block is documented as a
  Supabase **branching** feature, and `sl-fake-bets`/`sl-fake-bets-dev` are
  independent projects, not branches of one another — a bare push silently
  ignores the override and hands prod dev's `site_url` and dev's Google
  client (observed on the wire once; see `config.toml`'s own comment on the
  block). This script pushes the shared base config, then repairs
  `site_url` and the Google client with one `PATCH
  /v1/projects/<ref>/config/auth` call. Everything the two projects
  legitimately share — the redirect allow-list, confirm-email off, minimum
  password length 6, email provider on — comes from that shared base config
  and needs no repair.

### Where every secret lives

| File | Holds | Notes |
|---|---|---|
| `supabase/.env` (gitignored) | Both Google OAuth client id/secret pairs (dev + `_PROD_`), the two hosted redirect URLs, the `[remotes.production]` fields | Read by the CLI for every `env(...)` in `config.toml`; see `supabase/.env.example` |
| `.env.ops` (repo root, gitignored) | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, both project refs, both DB passwords, `SUPABASE_DEV_SECRET_KEY`, `CRON_SECRET` | `set -a; source .env.ops; set +a` before any ops command; see `.env.ops.example` for the full list and where each value comes from |
| `apps/web/.env.local` (gitignored) | Only `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, pointing at **dev** | The web app never sees a secret key, on either project — `grep -rn "SERVICE_ROLE\|sb_secret" apps/web` must always come back empty |
| Vercel's env store | The same two `NEXT_PUBLIC_*` names per environment (Production → prod, Preview/Development → dev), plus `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL` on Production only | `vercel env ls` is the source of truth and needs no login wall |

**Prod's `sb_secret_…` key is deliberately not stored anywhere.** When a task
needs it, fetch it for that task with `supabase projects api-keys
--project-ref "$SUPABASE_PROD_PROJECT_REF"` and don't write it down. Dev's
lives as `SUPABASE_DEV_SECRET_KEY` in `.env.ops`, for admin-API scripts
against dev only — it can never reach prod through that file by construction
(there is no `SUPABASE_PROD_SECRET_KEY` name anywhere).

### Getting a session as an agent — on dev, never on prod

- Sign in as a seeded fixture through the real form (`<name>@sl.local` /
  `slfakebets`) — the same screen a friend uses, no admin path needed.
- Or the password grant directly, headless: `POST
  https://qkwvmdshqnkfqekilipo.supabase.co/auth/v1/token?grant_type=password`
  with the same credentials.
- Or, for an identity the seed doesn't have, `auth.admin.createUser({
  email_confirm: true })` against dev with `SUPABASE_DEV_SECRET_KEY` — mints
  a session with no email sent.
- Headless Chrome over CDP (no Playwright/Puppeteer in this repo) drives the
  real form the same way a person would; Google sign-in remains the one flow
  that cannot be automated. There is no admin-API or seeded-fixture
  equivalent on prod, and there should never be one — prod's only accounts
  are real people.

### Day-to-day ops

- **Reading prod's logs.** Vercel: Dashboard → the project → Logs — retention
  is **one hour**, so "it broke last night" cannot be investigated there;
  ask for a screenshot and the build tag (the short git SHA in the profile
  menu and the auth-page footer) instead. Supabase: Dashboard → the project →
  Logs — API/DB logs keep **one day**, longer than Vercel's but still
  same-day-only.
- **Flipping a feature flag.** Studio → Table Editor → `feature_flags` →
  toggle a row's `enabled` boolean. Takes effect on the next page load, no
  deploy, no rebuild (ARC-016) — the mechanism is identical to local.
- **Resetting a friend's password.** There is no self-serve "forgot
  password" in early access (D1). Studio → Authentication → Users → the row
  → **Reset password**.
- **Resuming a paused dev project.** Dev is allowed to idle-pause after 7
  days without traffic. Dashboard → the paused project shows **Resume
  project**; a few minutes for a database this size, data intact for up to a
  year after pausing, and the publishable key is unchanged after restore.

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
| `migrations/20260906120000_team_chat.sql` | Extra Phase 1: `chat_messages` (UX-019), 30-day hard retention enforced by both a prune function and every read |
| `migrations/20260906130000_duel_schema.sql` | Extra Phase 2: 1v1 duel schema — `bets.kind` discriminator plus the 1:1 `bet_duels` side table |
| `migrations/20260906130100_duel_rpcs.sql` | Extra Phase 2: duel write-path RPCs — challenge, accept, decline, resolve, mediate |
| `migrations/20260906130200_duel_realtime_publication.sql` | Extra Phase 2: `bet_duels` joins the realtime publication |
| `migrations/20260906130400_duel_pair_rule_fix.sql` | Extra Phase 2 follow-up: two anti-spam defects and one inherited grant, found by the phase's own exit check |
| `migrations/20260907120000_user_locale.sql` | pt-BR (UX-027): `users.locale`, the per-account language column |
| `migrations/20260907123000_prune_chat_messages_revoke.sql` | Re-revokes `app.prune_chat_messages()` from `anon`/`authenticated`, undoing an unrelated migration's blanket re-grant (caught by the hosted privilege audit, below) |
| `migrations/20260907130000_alpha_flags.sql` | Hosted early access (D9): flips `locale-pt-br` on, seeds the `auth-google` ops kill switch |
| `migrations/20260907140000_analytics_events_size_check.sql` | Hosted early access: bounds `analytics_events.properties` at 4 KiB |
| `migrations/20260907150000_invite_links.sql` | Invite links: expiry choice & revocation (`plan-invite-links.md`) — nullable `invite_codes.expires_at`, the lazy-expiry predicate on `team_preview_by_code`/`join_team_with_code`, and the `create_invite_code`/`revoke_invite_code` RPCs that withdraw the table's last direct client write |
| `queries/arc-017-metrics.sql` | The two ARC-017 metrics, as SQL. This is the entire analytics product — run it in Studio; there is no dashboard |
| `seed.sql` | `mock-data.ts` as Postgres rows. Runs on `db reset` — **dev only, always**; `db push` never runs it without `--include-seed`, and no prod command in this repo ever passes that flag |
| `templates/magic_link.html` | Why email login was designed as a CODE, not a link — dormant until full release adds the SMTP vendor that makes editing it possible (`plan-hosted-early-access.md` §8) |
| `.env` (gitignored) | Google OAuth credentials for **both** environments, the hosted redirect URLs, and the `[remotes.production]` fields — see "Where every secret lives", above |
| `scripts/db-push-prod.sh`, `scripts/config-push-prod.sh` | The only two paths to prod — see above |
| `scripts/supabase-privilege-audit.sql` | For every table and function in `public`/`app`: does `anon`/`authenticated` hold exactly the grants the migrations intend? Zero printed rows = pass. Run on dev after any migration, and once on prod after `db:push:prod` |

## Things that will bite you

- **`seed.sql` is one transaction, deliberately.** Two deferred constraints
  need it: the DOM-001 leader-is-a-member trigger and the `bets`→`bet_options`
  winning-option foreign key. Splitting it into per-statement autocommits
  breaks both.
- **Triggers that gate writes must NOT be `SECURITY DEFINER`.** Inside a
  definer function `current_user` is `postgres`, so `app.is_service_context()`
  returns true and the trigger disarms itself for every caller. This silently
  let a moderator inject coins (DOM-024) until it was caught by the phase's
  own exit check. (`on_auth_user_created` IS a definer, correctly: it gates
  nothing, and the role inserting during signup is GoTrue's
  `supabase_auth_admin`, which has no rights on `public.users`.)
- **`seed.sql`'s profile insert is an UPSERT**, and must stay one. The
  `on_auth_user_created` trigger writes a randomly pre-filled profile the
  moment the seed inserts each `auth.users` row; the fixture values overwrite
  those. A plain insert fails with a unique violation.
- **The `db reset` confirmation prompt doesn't name the project.**
  `Confirm resetting the remote database? [Y/n]` looks identical whether the
  CLI happens to be linked to dev or (it must never be) prod. Don't trust the
  prompt — trust `supabase/.temp/project-ref`, and remember that only
  `scripts/db-push-prod.sh` / `scripts/config-push-prod.sh` may ever touch
  prod at all.
- **`--include-seed` must never appear next to a prod ref or connection
  string.** `db push` only runs `seed.sql` when that flag is passed — which
  is exactly why prod has never seen the ten `@sl.local` fixtures and must
  never. No script, alias or doc in this repo pairs `--include-seed` with
  anything prod-facing; don't be the first.
- **No email leaves either hosted project in early access** (D1 of
  `plan-hosted-early-access.md`). Password sign-up returns a session
  immediately with no confirmation step, and there is no "forgot password"
  yet — the honest answer for a friend who forgets is Google, or ask the
  owner to reset it in Studio (above).
- **The fixtures are stamped as already onboarded** (`seed.sql`, Phase 7.5),
  so signing in as Rafa lands on the dashboard rather than on the first-run
  profile step. To see that step, sign up a fresh account — a brand-new
  identity is the only case it exists for, and every existing row was
  backfilled by its migration.
- **Seeded accounts** are `<name>@sl.local` (rafa, duds, pri, tomate, careca,
  nina, guiz, lele, pinto, xis), password `slfakebets` — the exact
  credentials the real sign-in form takes. Dev only; `db reset` re-seeds them
  there and nowhere else.
- **Google OAuth** needs `supabase/.env` present — for local Docker and for
  both `config:push:*` scripts above. The dev client id/secret regenerate
  from the `client_secret_*.json` in the repo root if they go missing; the
  production client's secret exists only in `supabase/.env` and in the prod
  Google Cloud console — it was never downloaded to disk a second time after
  Phase 0 issued it.

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

**Realtime (Phase 8):** the publication carries `bets`, `wagers`, `comments`
and `bet_duels`, and must keep carrying only those — `team_members` and
`transactions` would cost ~450 messages per bet resolution and re-apply money
the acting client already moved. Replica identity stays at the default.
`agent-docs/design-realtime.md` §5 is the binding rule set, and it holds
identically hosted — the same publication, the same handlers, verified
against the hosted dev project in `plan-hosted-early-access.md` Phase 2/3.

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

**Still not built:** nothing from the closed local-MVP roadmap or its extra
phases. Hosted early access (ARC-012) shipped 2026-09-07 — see Hosted, above;
a full, non-"early access" production (email verification, a "forgot
password" flow) remains its own future, separately-ordered move.

## Only if you ever need the full stack offline again

Everything below describes the 100%-local Supabase CLI + Docker stack this
project ran on before 2026-09-07. It still works, and the schema is
identical to hosted's — but it is not the owner's daily driver any more, and
it is not where agents should verify anything (that's hosted dev, above).
Reach for this only if hosted dev is unreachable and offline work is the only
option.

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

**No email is sent in early access; the OTP template is dormant until full
release.** The auth screen has no OTP step any more (rewritten in
`plan-hosted-early-access.md` Phase 1) — sign-in and create-account are both
email + password, identically local and hosted, so there is no UI path left
that sends Mailpit anything to check. Mailpit still runs and would still
capture whatever GoTrue sent, if anything ever did.

**Local-only gotchas, on top of "Things that will bite you" above:**

- **`supabase stop --no-backup` deletes the database volume** — teams, bets
  and your own OAuth account. Plain `supabase stop` keeps everything
  (`backup: true` is the default); `supabase db reset` wipes and re-seeds by
  design. After any wipe, a live browser session points at a `public.users`
  row that no longer exists and team creation fails on
  `teams_leader_id_fkey` until you sign in again.
- **Don't stop the containers one at a time in Docker Desktop.** `kong` and
  `vector` have restart policies and the rest have dependent healthchecks, so
  stopping `db` alone makes half the stack thrash and restart. `supabase stop`
  goes down in dependency order; the Docker-native equivalent is
  `docker stop $(docker ps -q --filter name=sl-fake-bets)`.

**Verification note for agents, local stack.** Same mechanisms as hosted
dev's (above), with the local `service_role` key from `supabase status` in
place of `SUPABASE_DEV_SECRET_KEY`: a seeded fixture through the form, the
password grant, or `auth.admin.createUser({ email_confirm: true })` for an
identity the seed doesn't have. Headless Chrome over CDP (no
Playwright/Puppeteer in this repo) drives it the same way; Google OAuth
remains the one flow that cannot be automated.

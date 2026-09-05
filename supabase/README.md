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
- **Seeded accounts** are `<name>@sl.local` (rafa, duds, pri, tomate, careca,
  nina, guiz, lele, pinto, xis), password `slfakebets`. Dev only. The product's
  real email flavor is OTP; the password exists so you can jump straight into a
  specific member's session while testing policies.
- **Google OAuth** needs `supabase/.env` present. Regenerate it from the
  `client_secret_*.json` in the repo root if it goes missing.

## Not built yet

Phases 3–4 built schema, policies, connection, and **auth**. Sessions are real
(email OTP + Google OAuth, `apps/web/src/lib/auth-context.tsx`, refreshed by
`apps/web/src/proxy.ts`) and every new identity gets a profile row. But there
are still **no RPCs**: joining by invite code, placing a wager, resolving a bet,
the kick/ban cascade and the daily reward all remain in-memory in `apps/web`,
and move to the database in roadmap Phases 5–9. RLS here is a deliberate first
pass — roadmap risk #5 expects Phases 5–7 to tighten it against real access
patterns.

Phase 5's first blocker is unchanged: `team_members` INSERT covers only a
founder's own membership, so **there is no join path** until the
`join_team_with_code` SECURITY DEFINER RPC exists.

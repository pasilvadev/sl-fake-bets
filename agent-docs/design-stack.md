# Design: Tech Stack

**Status: APPROVED by owner (2026-09-04)**, with one amendment: no PostHog — no extra vendor for analytics/flags. Analytics and feature flags are implemented in-house on Supabase (see §3). PostHog is deferred (see §6).

Decision process: 3 independent stack proposals (maintenance-first, realtime/zero-cost-first, SEO/DX-first), each web-verified for September 2026 currency, adversarially judged against AGENT_SPEC constraints (ARC-001..019, UX-006, UX-017). Two proposals independently converged on this stack; Convex-based alternative lost on vendor count (required Clerk as a 4th vendor because Convex Auth is still beta) against ARC-003 (maintenance = #1 criterion).

## 1. The stack

| Layer | Choice | Notes (verified Sept 2026) |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript | SSR/SSG for UX-017 SEO; `opengraph-image` convention for UX-023/024 social cards; Server Components minimize client JS (UX-006). Pin exact version; follow security changelog (16.x had critical CVE patches Aug 2026). |
| Styling | Tailwind CSS v4 + shadcn/ui | shadcn components are copied into the repo (no runtime dep). Fits strict black/white identity (UX-020) without a theme system. |
| Backend / DB | Supabase (managed Postgres + Auth + Realtime + Storage) | One vendor, four layers. Relational SQL fits pari-mutuel pools (DOM-016), per-team balances (DOM-013/014), transaction ledger (DOM-025), leaderboards (DOM-027/028). Authorization via Row-Level Security policies. |
| Auth | Supabase Auth: email (OTP or magic link) + Google OAuth | Refresh tokens auto-renew silently → users effectively never re-login (ARC-007/UX-004). No MFA/hardening (ARC-008). Recommendation for open decision #7: **OTP code** — magic link breaks when opened on a different device/tab than signup. |
| Realtime | Supabase Realtime — **Postgres Changes** (see `design-realtime.md` §3) | Covers ARC-005/UX-013 (live bets/wagers) and bet-comment chat. Same mechanism local and hosted. Supabase now prefers Broadcast at scale; at this app's size Postgres Changes uses ~0.001% of its throughput ceiling and needs no trigger functions, so Broadcast is the documented escape hatch, not current work. |
| Hosting — frontend | Vercel Hobby (free) | 100GB transfer, 1M function invocations/mo, no card. Non-commercial ToS — see risks. |
| Hosting — backend | Phase 2: Supabase CLI + Docker (100% local via `supabase start`). Phase 3: Supabase Cloud free tier | Identical schema/migrations/code local → hosted; cleanest ARC-011→012 path, no rewrite. |
| Monorepo | pnpm workspaces + Turborepo | Layout: `apps/web`, `packages/shared`, `supabase/` (migrations, config), `mobile/` (empty placeholder, ARC-009). |
| Feature flags | In-house: `feature_flags` table in Supabase | See §3. No PostHog. |
| Analytics | In-house: `analytics_events` table in Supabase | See §3. No PostHog. |

## 2. Free-tier ceilings (ARC-001: document, never silently exceed)

> **Superseded in detail by `agent-docs/design-scale-and-free-tier.md`** (roadmap Phase 9, task 5): the ARC-001/ARC-004 document proper. It carries these same ceilings plus what each one actually costs at this app's shape, the order they are realistically hit in, and the scale-up path past each — documented, not built. The summary below stays as the stack decision's own record.

- **Supabase Free:** 500MB database, 1GB storage, 5GB egress, 50K MAU, 200 peak Realtime connections, 2M Realtime messages/month, 2 active projects/org. Projects auto-pause after 7 days without traffic.
- **Vercel Hobby:** 100GB fast data transfer, 1M edge requests, 1M function invocations, 6000 build minutes/month. Personal/non-commercial use only.
- Growth vectors to watch: avatar uploads (UX-022) vs 1GB storage; bet/wager/comment tables vs 500MB DB; realtime message volume vs 2M/month. **Egress (5GB) is the tightest of these in practice** — `design-realtime.md` §2 works the numbers: realtime with small payloads lands ~140MB/month, while polling `loadTeamData` on a 15s timer would spend the entire monthly 5GB in under two days.

## 3. Analytics & feature flags without PostHog (owner amendment)

Verified Sept 2026: Vercel Web Analytics on Hobby is pageview-only (custom events are Pro-only) and has no funnel analysis on any plan; Supabase has no product-analytics feature (its "Logs & Analytics" is infra telemetry; "Analytics Buckets" is a data-lake alpha). Neither can deliver ARC-017's two metrics. Therefore:

- **Analytics (ARC-017):** an `analytics_events` table in the app's own Postgres (`event_name`, `anonymous_id`/`user_id`, `properties jsonb`, `created_at`), written from the app at the instrumented steps. **Built in roadmap Phase 9:** the writer is `apps/web/src/lib/analytics.ts` and the two queries are `supabase/queries/arc-017-metrics.sql`. The two mandated metrics are plain SQL queries (onboarding per-step drop-off; invite-open → completed-signup conversion). At this scale (~30 users/team, few teams) volume is trivial. Build NOTHING beyond these two metrics (ARC-017 cap). A dashboard is unnecessary — SQL in Supabase Studio suffices; do not build one unless the owner asks.
- **Feature flags (ARC-016):** a `feature_flags` table (`key`, `enabled boolean`, `payload jsonb`) read by the app at request/load time. **Built in roadmap Phase 9:** read server-side in the root layout, handed down by `apps/web/src/lib/feature-flags.tsx`. Toggling a row in Supabase Studio changes behavior with no deploy or rebuild — satisfies ARC-016. No per-user targeting or % rollouts unless a future feature demands it.
- Both live in the same Postgres → work identically in Phase 2 (local) and Phase 3 (hosted), zero extra vendor, zero extra cost.

Optional free extra: Vercel Web Analytics (pageviews only, 50K events/mo on Hobby) may be enabled for traffic visibility, but it does not count toward ARC-017 and must not replace the events table.

## 4. Implementation rules (binding for agents)

1. **Coarse-grained realtime subscriptions only:** subscribe per team / per bet-list / per bet page — never per-row or per-field. Protects the 200-connection / 2M-message ceilings. **Extended 2026-09-05 by `design-realtime.md`** (cost analysis run before Phase 8, quotas re-verified that day): coarse channels are necessary but not sufficient — a handler must apply the event payload rather than refetch the world, and `team_members`/`transactions` must not be subscribed at all. That document's §5 is binding alongside this list.
2. **GA APIs only:** use only Supabase features that are GA. Anything Supabase labels alpha/beta is deferred until it graduates.
3. **Pin versions:** exact versions in package.json (especially Next.js); upgrade deliberately via security changelogs, never track `latest`.
4. **Tunable config, no magic numbers:** onboarding grant (~100), daily reward (~5), team size (~30), bet-duration presets live in config (DOM-021/022, ARC-018).
5. **Vendor count is frozen at 2** (Vercel, Supabase) + GitHub. Adding any third service requires explicit owner approval.
6. **Phase discipline:** ARC-013 applies — no Supabase project creation, no deploys, nothing beyond Phase 1 mocks until the owner explicitly orders each phase transition.

## 5. Risks & mitigations

- Supabase free auto-pause (7 idle days): schedule a keep-alive ping (GitHub Actions cron hitting a lightweight endpoint) when Phase 3 starts.
- Vercel Hobby non-commercial ToS: fine for a for-fun friends app; any monetization (even donations) forces Pro ($20/mo) — re-check at that moment.
- Google OAuth shows an "unverified app" warning until the consent screen is verified — acceptable friction for a friend-group tool; note against UX-001. One-time Google Cloud console setup required.
- Magic-link cross-device gotcha: resolved by preferring OTP (see §1 Auth).
- Lock-in exit path (feeds ARC-004 docs): data is plain Postgres — `pg_dump`/`pg_restore` to any Postgres host, or self-host Supabase's open-source Docker stack. Supabase-specific glue (RLS policies, Realtime wiring, Edge Functions) would need rewriting.
- Vendor concentration: Supabase outage/pricing change hits DB+auth+realtime+storage+flags+analytics at once. Accepted trade-off per ARC-003 (fewest moving parts wins).

## 6. Deferred: PostHog

Not adopted now (owner decision 2026-09-04: no extra vendor for analytics). Revisit only if: (a) analytics needs grow beyond ARC-017's two metrics, (b) flags need targeting/% rollouts, or (c) funnel analysis in SQL becomes a real maintenance burden. Free tier as of Sept 2026: 1M events + 1M flag requests/month, no card.

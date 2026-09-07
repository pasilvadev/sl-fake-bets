# SL Fake Bets — Hosted Early Access Plan (ARC-012, and one step past it)

**Status: PLAN, written 2026-09-07, amended the same day. Not yet ordered.**
This is the vision Phase 2→3 transition (`ARC-012`), which `ARC-013` says needs
its own explicit, in-the-moment owner order. §4 (Phase 0) is that order in
practice: the moment the owner hands an agent the tokens Phase 0 asks for, the
transition is on. Nothing in Phases 1–5 runs before that.

**Owner requirement, stated 2026-09-07:** bring the app from the current local
Docker state to a hosted early access where a friend group can alpha test it —
friends sign themselves up, the UX is a release's UX (no alpha banner, no
"add me as a tester" step, no accounts created for them by hand), everything on
free-tier vendors, and the owner keeps developing on this Mac **without running
Docker containers**. Every step the owner must personally do is batched into
Phase 0 so agents can build the rest.

**Owner decisions taken on the research, same day (D1, D8):**

- The research found that the product's email-code login cannot reach anyone
  outside the owner's own Supabase team on the hosted free tier without a
  third-party SMTP sender (§2.1). Rather than add a vendor for the alpha, **the
  early access ships with two doors: Google, and email + password with no
  email verification.** No email leaves either project during early access.
- **The email code, "forgot password", and the SMTP vendor that makes them
  possible are registered for the full release** (§8), not dropped. The
  research on them (§2.1) is kept here so that release does not redo it.
- **A password sign-up has nothing to pre-fill a name from, so the account
  creation form requires a typed display name.** Google sign-ups keep their
  provider-supplied name. This is a deliberate carve-out from UX-002's
  "every input pre-filled" rule, for one field, on one path.

**Phase 0 part A answered by the owner, 2026-09-07 (D9, D2, D12):**

- **D9 — `locale-pt-br` ships ON** for the alpha; the Phase 1 flags migration
  flips it.
- **D2 — names confirmed as written:** Supabase `sl-fake-bets-dev` and
  `sl-fake-bets`, Vercel `sl-fake-bets`.
- **D12 — acknowledged:** this plan is the ARC-013 order for the vision 2→3
  move and the step past ARC-012's "still dev/staging" wording.

The answers are also recorded as comments at the top of the owner's `.env.ops`
(gitignored), which now exists with empty `SUPABASE_ACCESS_TOKEN=` and
`VERCEL_TOKEN=` slots for Phase 0 part B. Part B is the owner's next step;
Phase 1 needs nothing from Phase 0 and may run alongside it.

---

## 0. Scope, in one paragraph

Two Supabase Cloud free projects in one org — `sl-fake-bets` for friends, and
`sl-fake-bets-dev` as the owner's Docker-free daily driver and the target of
Vercel preview deployments — plus one Vercel Hobby project whose Production
environment points at the first and whose Preview environment points at the
second. Email + password login with no verification email, Google sign-in via a
published consent screen, a daily Vercel cron so the production project never
idles into a pause, a guarded prod-push script so the destructive CLI commands
can only ever reach dev, and a handful of small code changes that a release-like
alpha needs (a privacy page, a real sign-in/create-account screen with catalog
errors, an error boundary, a build tag). Vendor count stays at two plus GitHub.
No custom domain, no paid tier, no new features: the roadmap's scope-creep
exclusion list (`plan-mvp-roadmap.md` §6 risk 7) holds through every phase here.

---

## 1. Read first

**Docs.** `AGENT_SPEC.md` §4.3 ARC-001/002/003/006/012/013 (the constraints this
plan executes under), §4.1 UX-002 (the rule D8 carves out) and §0 (doc
protocol — this file is registered in §1). `design-stack.md` §1 (the hosting
and auth rows), §2 (ceilings), §4 rule 5 (the vendor freeze, unchanged by this
plan) and §5 (the risks this plan retires or restates).
`design-scale-and-free-tier.md` §0 ("where the app actually is" — this plan
moves it), §2.6 (idle pausing — D4), §3 (arrival order of the ceilings) and §5
(the "re-read before ARC-012" instruction, honored by §2 below).
`plan-mvp-roadmap.md` §4.1 (the OTP decision this plan suspends until full
release), Phase 4, Phase 7.5 and Phase 9 execution notes — the last names "a
real social-preview debugger" as the first thing to re-check after this
transition. `supabase/README.md` in full: it is the document Phase 4 rewrites.

**Code.** `supabase/config.toml` (`[auth]` at :154–270 — `enable_confirmations
= false`, `minimum_password_length = 6` and `password_requirements = ""` are
what make password sign-up instant and low-friction; `[auth.external.google]`
at :361–370; `[api]` at :7–24 — the `auto_expose_new_tables` comment matters),
`supabase/migrations/20260905130000_auth_profile_bootstrap.sql` :41–53 and
`20260905180000_onboarding_profile_step.sql` :47–58 (both read `display_name`
from sign-up metadata — the reason D8 needs no schema change),
`supabase/seed.sql` :1–95 (why it must never touch prod; also: the fixtures
already have passwords), `apps/web/src/lib/site.ts` (the `siteUrl()` fallback
chain), `apps/web/src/proxy.ts`, `apps/web/src/app/auth/callback/route.ts`,
`apps/web/src/components/auth/auth-page.tsx` (the screen Phase 1 task 5
rewrites), `apps/web/src/components/onboarding/profile-step.tsx` (how
`prefill` chooses the primary action), `packages/shared/src/validation.ts`
:320–340 (`validateProfileDraft` and its `display-name-required` code),
`apps/web/src/lib/supabase/server.ts` (`smokeTest()` is the keep-alive query),
`apps/web/src/components/team-gate.tsx` :64–206 (the empty-database first
run), `packages/shared/src/infra.ts` (the flag union D9 touches).

---

## 2. What the research established (verified 2026-09-07)

Seven research passes, each web-verified against vendor documentation on
2026-09-07, then every load-bearing claim independently re-checked by an
adversarial pass that tried to refute it. What survived is below; what was
refuted is corrected in place. Provenance in §9. Quotas and policies are
September-2026 snapshots — `design-scale-and-free-tier.md` §5 says when to
re-take them.

### 2.1 Email: the built-in mailer cannot reach your friends — and what the alpha does about it

Three independent facts, each verified against supabase.com and each fatal to
the email-code login on its own:

1. **Recipient restriction.** "Unless you configure a custom SMTP server for
   your project, Supabase Auth will refuse to deliver messages to addresses that
   are not part of the project's team." A friend requesting a code gets
   `Email address not authorized`. This applies on every plan, to every auth
   email type including `signInWithOtp`. (docs/guides/auth/auth-smtp)
2. **Two emails per hour, project-wide.** "You can only change this with a custom
   SMTP setup." (docs/guides/auth/rate-limits)
3. **Template lock on new free projects.** Since 2026-06-03, new free-tier
   projects on the default mailer cannot modify their auth email templates at
   all. The whole reason email login was a *code* is `templates/magic_link.html`
   rendering `{{ .Token }}` instead of a link — on the default mailer, a project
   created today cannot apply it. Custom SMTP lifts the lock. (changelog/46599)

**The alpha's answer (D1): send no email at all.** Password sign-up with
`enable_confirmations = false` (already the config) returns a session
immediately and triggers no message; Google sign-in never touches the mailer.
Nothing in early access requests, resets or confirms anything by email. The
findings above are kept because the full release will need them:

- With custom SMTP the default cap becomes 30/hour and is raisable
  (`rate_limit_email_sent`), the recipient restriction disappears, and templates
  are editable. **The template is not carried by `supabase config push`** —
  Supabase's docs say to paste it into the Dashboard — but the Management API
  (`PATCH /v1/projects/{ref}/config/auth`, field
  `mailer_templates_magic_link_content`) accepts it directly, so an agent
  holding the owner's access token can push it without a click.
  `[auth.email.smtp]` with `pass = "env(...)"` and `[auth.rate_limit]` are part
  of the config-as-code surface.
- Free SMTP options ranked for that day (zero cost, no domain purchase, no
  card, arbitrary recipients from day one):

| Provider | Free cap | Needs a domain you own? | Card? | Verdict |
|---|---|---|---|---|
| **Brevo** | 300/day | **No** — verify one sender address by clicking a link | No | **The one to pick at full release.** `smtp-relay.brevo.com:587`, user = Brevo login email, pass = an *SMTP key*. Without an authenticated domain Brevo relays Gmail/Yahoo/Microsoft-bound mail through its own `@brevosend.com` domain — cosmetic, and the reason a domain is worth its price then. |
| Resend | 3,000/mo, 100/day | **Yes** — `onboarding@resend.dev` delivers only to the account owner | No | Easy upgrade once a domain exists. |
| Gmail SMTP + App Password | ~500/day | No | No | Works; personal mailbox as a relay; stopgap only. |
| Postmark | 100/mo | No | No | Manual approval before non-owner recipients; cap too thin. |
| Mailjet | 200/day | Sender validation | Unverified | No advantage over Brevo. |
| MailerSend | 500/mo | Trial domain only | **Yes** | Card on file — out. |
| Amazon SES | Sandbox only | Sandbox blocks unverified *recipients* | **Yes** | Out. |
| SendGrid | — | — | — | Free plan retired 2025-07-26. |

**Refuted, do not build on it:** "disable email login by setting `[auth.email]
enable_signup = false`". The flag's real behavior is contested by Supabase's own
CLI maintainers (it maps to the whole-provider switch, contradicting this repo's
config.toml comment and Supabase's general docs — supabase/cli PR #4469, closed
unresolved). The alpha does not touch that flag: the email provider stays on,
and is used for passwords.

### 2.2 Google sign-in: publish the consent screen; the scary screen is not this app's problem

- The console UI is now **Google Auth Platform** (APIs & Services → Google Auth
  Platform, or `console.cloud.google.com/auth/…`) with four tabs: Branding,
  Audience, Data Access, Clients. Direct links, pinned to this project, are in
  Phase 0.
- In **Testing** status only up to 100 listed test users can sign in, and each
  grant expires after seven days (support.google.com/cloud/answer/15549945).
  That is precisely "adding testers by hand", so it is not an option.
- Moving to **In production** is the **Publish app** button. Supabase's Google
  provider requests only `openid`, `email`, `profile` — all **non-sensitive** —
  so no Google verification review is required (answer/13463073), and the
  "Google hasn't verified this app" interstitial plus its 100-user lifetime cap
  **do not apply**: that mechanism is defined strictly for apps requesting
  sensitive or restricted scopes (answer/7454865). The first research pass
  claimed brand verification was needed to escape it; the adversarial pass
  refuted that. Brand verification (logo + name on the consent screen) is
  cosmetic and optional.
- **Genuinely unverified, and only a live click can settle it:** whether the
  Publish button demands a homepage and privacy-policy URL for a
  non-sensitive-scope app, and whether Google's "Authorized domains" field
  accepts a `*.vercel.app` hostname (vercel.app is on the public-suffix list;
  Google's policy page recommends "your own domain" for shared-hosting cases).
  Phase 0 step 8 is a ten-minute test with three fallbacks (D7). Independently
  of Google, the alpha gets a privacy page anyway (D8) — it is the honest thing
  to have on a public URL that stores emails, passwords (hashed by Supabase),
  Google profile basics and avatars.
- Without brand verification the consent screen shows the project's
  `<ref>.supabase.co` host rather than the app name — Supabase's own docs say
  this "does not inspire trust". Acceptable friction for a friend group;
  removable later with a custom Supabase domain (paid) or brand verification.
- The callback URI is `https://<project-ref>.supabase.co/auth/v1/callback`;
  the OAuth client type must be **Web application**. The existing dev client
  registers only `http://127.0.0.1:54321/auth/v1/callback` and origin
  `http://localhost:3000`. The Google Cloud project id is `sl-fake-bets`.
- `skip_nonce_check = true` (config.toml :369) exists only for the local
  GoTrue; hosted GoTrue needs `false`. Since Docker is retired, it becomes
  permanently `false` (D7), not a per-environment toggle.

### 2.3 Supabase Cloud free tier, as it stands

| Fact | Value | Consequence |
|---|---|---|
| Active free projects | **2 per owner**; paused projects don't count | Exactly prod + dev. A third means deleting or pausing one. |
| Idle pause | after **7 days** of low activity; "a few requests to the database each day" prevents it; dashboard visits count | D4: a daily cron against prod. Let dev pause. |
| Restore | Dashboard "Resume project" button, up to **1 year** after pause; data intact; a few minutes for a DB this size (community figure) | Phase 5 drills it once. |
| Regions | São Paulo `sa-east-1` available, no plan gate | Both projects there. |
| Compute | Nano: shared CPU, 0.5 GB RAM, 60 direct connections, 200 pooler clients | The app talks REST, not Postgres; Realtime's RLS-check pool on Nano is the one thing to observe under real use (Phase 3). |
| API keys | New projects get **`sb_publishable_…`** / **`sb_secret_…`**, not legacy `anon`/`service_role` JWTs (since 2025-11-01); the publishable key is a drop-in for the `anon key` argument of every client-library version; `getClaims()` works on legacy and asymmetric signing keys alike | The env var keeps its name; its value changes shape. |
| Data API exposure | **New projects since 2026-05-30 do not auto-expose `public` tables**; each needs explicit `GRANT`s | Already true of this schema: `20260905120400_rls_policies.sql:320-331`, `team_chat.sql:138`, `duel_schema.sql:345` grant every table by name — that migration's own comment anticipated "the project's auto-expose default" changing. Functions are granted by name too. Phase 2 runs a privilege audit on dev to prove it, and config.toml gets `auto_expose_new_tables = false` so any future local run matches the cloud. |
| `postgres` role | not superuser; only `COPY … FROM PROGRAM` and `ALTER USER … SUPERUSER` are unavailable | `auth.users` triggers, `pg_cron`, storage policies, publication `ALTER`s and `SECURITY DEFINER` functions all run via `db push`. The pg_cron `DO` block already degrades gracefully. |
| Branching | Pro and above | Two projects, not branches. |
| Headless CLI | `SUPABASE_ACCESS_TOKEN` env var skips `supabase login`; `projects create --org-id --region --db-password`; `projects api-keys --project-ref`; `link --project-ref -p`; `db push`/`db reset` accept **`--project-ref`** (present in the installed v2.116.0 `--help`, missing from the web reference — trust the binary) | Everything after account creation is agent work. |
| `db push` | migrations only; seed runs **only** with `--include-seed` | Prod never sees `seed.sql` unless someone types that flag. |
| `db reset --linked` / `--project-ref` / `--db-url` | drops every user-created object on the **remote**, re-applies migrations, **re-seeds by default**; the prompt is "Confirm resetting the remote database? [Y/n]" and **does not name the project** (cli issues #33399, #3910, #1326 "can corrupt data in production") | D3: the repo is linked to dev, permanently. Prod is reached only through a wrapper that refuses `reset`. |
| Password sign-up | `signUp({ email, password, options: { data } })` with confirmations disabled returns a session at once and sends nothing; the `data` object lands in `raw_user_meta_data`, which the sign-up trigger already reads | D1/D8 need no migration. |
| Admin API | `auth.admin.createUser({ email_confirm: true })` and `auth.admin.generateLink()` send no mail and were explicitly exempted from the recipient restriction | Agents mint sessions on dev without any inbox — though with passwords in play, the seeded fixtures are the cheaper path. |
| Seeded accounts on hosted | `seed.sql`'s `auth.users` + `auth.identities` insert uses `extensions.crypt`, and pgcrypto is installed by default in `extensions` on hosted Postgres | `db reset` on **dev** yields the ten `@sl.local` accounts with password `slfakebets`, same as local — and after Phase 1 they sign in through the real form. Dev only. Re-verify after any hosted Postgres/Auth version bump. |
| Email templates | `content_path` is local-only; hosted takes Dashboard paste or Management API | Dormant in early access; recorded for full release (§8). |

### 2.4 Vercel Hobby, as it stands

| Fact | Value | Consequence |
|---|---|---|
| Included | 100 GB transfer, 1M edge requests, 1M function invocations, 4 CPU-hours (Fluid/Active CPU), 6,000 build minutes; runtime logs kept **1 hour**; no card | Trivial at this shape. One-hour log retention means "look at the logs later" does not exist — Phase 5. |
| Non-commercial clause | "financial gain of anyone involved in any part of the production"; donations explicitly exempt; ads and affiliate links count | Fake coins, no ads, no paid contributor: compliant. Standing constraint on the product. |
| Package manager | Vercel's supported table stops at **pnpm 10**; this repo pins **pnpm 11.25.0** (`lockfileVersion 9.0`, `allowBuilds` in `pnpm-workspace.yaml`); vercel/vercel#17434 is open; the failure is a **loud** build error, not a silent fallback | Phase 2 task 6: `ENABLE_EXPERIMENTAL_COREPACK=1` first, an explicit `installCommand` second, pnpm 10 last. Test on a preview before anything else depends on it. |
| Node | 24.x default; 22.x available; `engines.node` in the *deployed app's* package.json overrides project settings; `>=22.13.0` at the repo root would resolve to 24 | Set `nodeVersion: "22.x"` on the project and `"engines": {"node": "22.x"}` in `apps/web/package.json`. |
| Monorepo | Root Directory `apps/web`; Turborepo is auto-detected (build becomes `turbo run build` from the workspace root); the "include files outside root directory" toggle is the fallback if `@repo/shared` is not found | Zero config expected; one fallback named. |
| `proxy.ts` | Node.js runtime by default in Next 16 (cannot be changed); Turbopack is the default for `next build` | No action. Verified from the docs bundled in this repo's installed `next@16.3.4`. |
| `VERCEL_PROJECT_PRODUCTION_URL` | universal system env, bare hostname, set on previews too, **only if "Automatically expose System Environment Variables" is on** (`autoExposeSystemEnvs`) | `siteUrl()` already prefers `NEXT_PUBLIC_SITE_URL`; Phase 2 sets that explicitly in Production *and* turns the system envs on, so a misconfiguration cannot make production metadata point at `localhost:3000`. |
| Deployment Protection | Vercel Authentication with Standard Protection is on by default: **preview and deployment URLs need a Vercel login; the production domain is public** | Friends only ever get the production URL. Google sign-in **cannot be tested on a preview URL**, ever, on Hobby: the login wall intercepts before `proxy.ts` runs. Test OAuth on localhost (against dev) and on production. |
| Supabase redirect allow-list | supports `https://*-<scope-slug>.vercel.app/**` for previews; `*` stops at `.`/`/`, `**` does not | `<scope-slug>` is the Vercel *account* slug, not the project name — read it from `vercel whoami`. |
| Cron | 100 per project, **once per day at most**, fires within a ±59-minute window, runs an ordinary function | Daily is plenty against a 7-day pause. `vercel.json` in `apps/web`. |
| GitHub Actions schedules | auto-disabled after 60 days without a commit on a **public** repo (`pasilvadev/sl-fake-bets` is public); Actions minutes are free on public repos | Not the keep-alive mechanism (D4). Fine for CI (D11). |
| Git integration | `vercel link`, project settings via `vercel api … -X PATCH`, env vars via `vercel env add`, `vercel deploy --prod` and `vercel git connect` all work with a token; **installing the Vercel GitHub App on the repo is a one-time browser consent** | Phase 0 step 6. |
| Production hostname | `<project-name>.vercel.app` when the name is free (Vercel assigns the final hostname at creation; the agent reports it); custom domains cost only the registration, elsewhere | `NEXT_PUBLIC_SITE_URL` is filled in *after* creation. |
| Web Analytics | 50K events/month, first-party, one component | Optional, not analytics per ARC-017; not added by this plan. |

### 2.5 The codebase is closer than expected

Verified by reading and by running, with Docker off:

- `pnpm --filter web typecheck`, `pnpm --filter web build`, `pnpm build`,
  `pnpm --filter @repo/shared test` (823 tests) and `pnpm lint` are **all green
  against a dead local stack**. Every user route is `ƒ` (dynamic); the only
  static routes are `robots.txt` and `sitemap.xml`, which read `siteUrl()` and
  nothing else. `next build` on Vercel therefore does not need Supabase env vars
  to succeed — misconfiguration shows at runtime, not at build.
- The only `process.env` reads in `apps/web/src` are the two `NEXT_PUBLIC_SUPABASE_*`
  values (three files, each with a bare `!` assertion — Phase 1 task 3),
  `NEXT_PUBLIC_SITE_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `NEXT_PUBLIC_I18N_DEBUG`
  and `NODE_ENV`. Every dev-only path (the Mailpit hint at `auth-page.tsx:406`,
  the consistency guard, key-reveal mode) is `NODE_ENV`-gated and dead-code
  eliminated by `next build`.
- **Password sign-up is already wired below the UI.** `app.default_display_name`
  (`auth_profile_bootstrap.sql:41-53`) reads `full_name`, `name`, then
  `display_name` from the sign-up metadata, and `app.profile_prefill_kind`
  (`onboarding_profile_step.sql:47-58`) marks any of those three as
  `'provider'` quality. A typed display name passed as
  `options.data.display_name` therefore becomes the account's real name and
  the first-run profile step treats it as one (primary action "looks good",
  not "change it"), with no migration. `validateProfileDraft` already owns
  `display-name-required`.
- Invite and share links are built from `window.location.origin` inside click
  handlers on purpose (`invite-modal.tsx:19-34`, `bet-row.tsx:458-465`) — correct
  on any host, including previews.
- The empty-database first run is fully built: `TeamGate` → `NoTeamsScreen`
  (create or join on one screen) → `create_team` → `app.seed_membership` grants
  the onboarding coins to founder and joiner alike → dashboard with "Invite
  Friends". `/join/[code]` wraps `JoinFlow` in `AuthGated` only, so a logged-out
  visitor authenticates in place and lands on the join modal (UX-012). Banned
  visitors get their own message. No fixture id is referenced anywhere in
  `apps/web/src`; `mock-data.ts` is never imported at runtime.
- Product gaps a friend would notice, all small: the auth screen shows raw
  Supabase SDK error strings (`auth-page.tsx:103, :131, :153`) where every other
  surface goes through the `errors.*` catalog; there is no `error.tsx` anywhere,
  so an unanticipated client exception falls to Next's bare default page; no
  privacy page; no build identifier for bug reports; one `100vh` (should be
  `svh`) on the desktop-only rail container (`dashboard-page.tsx:33`).
- Abuse surface on a public URL, ranked: `skip_nonce_check` (fixed by D7) ≫
  everything else. Invite codes are 31^8 ≈ 8.5×10¹¹ combinations; chat has a
  DB-enforced flood trigger; duels have a pending cap; `analytics_events`
  accepts anonymous inserts with an unbounded `properties` blob (low × low; a
  `pg_column_size` check is Phase 1 task 9). Unverified emails (D1) add one
  more: a friend can register another friend's address — see §7.

---

## 3. Decisions this plan takes (owner may overrule)

- **D1 — Early access auth: Google + email/password, no verification email; the
  code login and password reset move to the full release.** Owner ruling
  2026-09-07, on §2.1's findings. Consequences: the vendor count stays at two
  (`design-stack.md` §4 rule 5 is untouched), no SMTP is configured on either
  project, no template is pushed, `templates/magic_link.html` stays in the repo
  dormant, and the alpha has **no "forgot password"** — the fallback doors are
  Google, or the owner resetting a password for a friend in the hosted Studio
  (Authentication → Users → the row → reset). `plan-mvp-roadmap.md` §4.1's
  "OTP code, not magic link" decision is suspended, not reversed: it returns
  with the SMTP vendor at full release (§8). ARC-008 covers the trade: email
  addresses are taken on trust, not proven.

- **D2 — Topology: two Supabase projects, one Vercel project, one region.**
  `sl-fake-bets` (production, friends) and `sl-fake-bets-dev` (the owner's
  local `next dev` target, the Preview target, the agents' verification
  target), both `sa-east-1`, both Nano. Vercel project `sl-fake-bets`
  (hostname reported after creation), Root Directory `apps/web`, Production
  env → prod project, Preview and Development env → dev project. Vercel
  function region set to `gru1` (São Paulo) **if the Hobby project settings
  offer the dropdown** — unverified for Hobby; the default `iad1` costs roughly
  one transatlantic round trip per server render and is acceptable if not.

- **D3 — The CLI is linked to dev, forever. Prod is reached only through a
  guard.** `supabase link --project-ref <dev-ref>` once; every bare `db push`,
  `db reset`, `config push`, `migration list` therefore lands on dev. Prod is
  touched by exactly one script, `pnpm db:push:prod`, which (a) fails unless
  `SUPABASE_PROD_PROJECT_REF` and `SUPABASE_PROD_DB_PASSWORD` are set, (b)
  prints the target ref, (c) runs `supabase db push --project-ref … --dry-run`
  and shows the pending migrations, (d) requires the operator to type `prod`,
  then (e) runs the push. **No script, alias or doc ever puts a prod ref or a
  prod connection string next to `db reset` or `--include-seed`.** The env
  variable names carry `PROD`/`DEV` in them so nothing can be confused by a
  typo. Rationale is §2.3's reset row: the CLI's own prompt does not name the
  project it is about to erase.

- **D4 — Keep-alive is a Vercel cron, not a GitHub Actions schedule, and it
  pings prod only.** `design-stack.md` §5 and `design-scale-and-free-tier.md`
  §2.6 both name a GitHub Actions cron; this plan changes that, and says so
  rather than substituting silently. Reason: on a public repo a scheduled
  workflow silently disables itself after 60 days without a commit — a
  quiet-month failure mode for exactly the service whose failure mode is a
  quiet week. A Vercel cron has no such trap, adds no vendor, and Hobby's
  once-per-day floor is ample against a 7-day pause. The route
  (`/api/keepalive`) does a real query — `smokeTest()` reading `feature_flags`,
  the one table `anon` may read — and is protected by Vercel's `CRON_SECRET`
  bearer header. The dev project is allowed to pause between work sessions; a
  Dashboard "Resume" costs a few minutes at the start of a session and nothing
  otherwise.

- **D5 — `config.toml` stays the single source of auth config and is pushed to
  both projects; per-project differences live in `[remotes.*]` overrides, with
  the Management API as the fallback.** The Supabase CLI's config-as-code
  supports `[remotes.<name>]` blocks keyed by `project_id` whose nested
  sections override the base when pushing to that project — that is how
  `site_url` becomes `http://localhost:3000` for dev and the Vercel URL for
  prod from one file. **Verify on dev first**: if `config push --project-ref`
  does not honor the override the way the docs describe, the fallback is the
  Management API (`PATCH /v1/projects/{ref}/config/auth` — `site_url`,
  `uri_allow_list`, `external_google_*` are fields on it), scripted per
  project. Either way the redirect allow-list carries
  `http://localhost:3000/**`, `http://127.0.0.1:3000/**`,
  `https://<prod-host>/**` and `https://*-<vercel-scope>.vercel.app/**`, and
  `additional_redirect_urls` becomes the union so both projects accept both
  origins (the Google JS-origin allow-list is what actually scopes OAuth per
  environment).

- **D6 — Email is silent in early access, and the code says so.** No SMTP, no
  templates, no reset link, no "check your inbox" copy anywhere. The
  `devMailpit` string and the Mailpit hint leave the auth screen with the OTP
  step (Phase 1 task 5). `double_confirm_changes` and `secure_password_change`
  are irrelevant because no surface changes an email or a password in the
  alpha. If a friend asks "how do I reset my password", the honest answer for
  the alpha is D1's: use Google, or ask the owner.

- **D7 — Two Google OAuth clients, published consent screen, `skip_nonce_check`
  permanently `false`.** The existing dev client keeps `http://localhost:3000`
  as its JS origin (local `next dev` against hosted dev still presents as
  localhost) and gains one redirect URI, `https://<dev-ref>.supabase.co/auth/v1/callback`.
  A new **Web application** client, "SL — production", gets
  `https://<prod-ref>.supabase.co/auth/v1/callback` and JS origin
  `https://<prod-host>`. Its secret goes into `supabase/.env` under its own
  name and is referenced by the prod `[remotes]` override. The consent screen
  is **published** (Phase 0 step 8). Three fallbacks if Publish demands a
  homepage/privacy URL on an authorized domain and rejects `vercel.app`:
  (a) publish with the Branding links blank — allowed for non-sensitive scopes
  if the UI permits it; (b) keep Google hidden behind the new `auth-google`
  flag (Phase 1 task 2) and run a password-only alpha until resolved — with
  D1 this is a complete, working alpha, not a degraded one; (c) the owner buys
  a domain (~US$10–20/yr) — breaks zero-cost, owner's call, and the only path
  to a trustworthy consent screen anyway. Brand verification is not required
  and not pursued now.

- **D8 — Release-like polish, and one owner ruling on onboarding.** In: the
  auth screen becomes a real **sign in / create account** screen (D1) — sign in
  is email + password; create account is email + password + **a required
  display name**, sent as `options.data.display_name` so the existing trigger
  makes it the account's real, provider-quality name (§2.5). This is the
  owner's carve-out from UX-002 for the one field that has nothing to pre-fill
  from on that path; Google sign-ups still arrive pre-filled from the
  provider, and the Phase 7.5 profile step still runs for both, unchanged. Also
  in: auth-screen errors routed through `MutationErrorCode` like every other
  surface; a `/privacy` page (English; a `privacy` message namespace so it
  follows the locale if pt-BR is on); a root `error.tsx` in the house style; a
  build tag from `VERCEL_GIT_COMMIT_SHA` in the profile menu and auth-page
  footer (a short SHA is what shipped consumer apps do; it is not an alpha
  banner); the `100vh` → `100svh` nit; a friendly throw when the Supabase env
  vars are missing. Out: any in-app bug-report surface — **team chat is the
  alpha's feedback channel**, written down here so no later session proposes a
  widget against ARC-017 and the vendor freeze; a "service is paused" screen
  (D4 makes it a non-event; fail-soft to signed-out is the coded behavior); an
  admin UI (Supabase Studio is the control plane, now the hosted one); any
  password-strength meter or requirement beyond Supabase's minimum of 6
  (ARC-008, UX-001).

- **D9 — Flags at launch.** `duel-bets`, `global-team-chat` and
  `coming-soon-teasers` ship ON, as seeded — they gate finished, verified
  features and are kill switches, not gates. `locale-pt-br` is seeded OFF; the
  pt-BR pass is complete and browser-verified (`plan-i18n-ptbr.md` §8) and the
  friend group is Brazilian, so **the recommendation is ON in a migration**
  (`update … where key = 'locale-pt-br'`, the same shape `team_chat.sql:433`
  used) so dev and prod agree and the decision is in git. **Owner confirmed ON,
  2026-09-07.** The new `auth-google` flag (D7) ships ON. Everything else stays
  OFF.

- **D10 — Where every secret lives, by name.** Two gitignored files and the
  Vercel env store; nothing else. `supabase/.env` (already exists, consumed by
  `config.toml`'s `env()`): `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`
  (dev client, unchanged), `SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID/SECRET`.
  `.env.ops` at the repo root (new; `.gitignore` already ignores `.env.*`, add
  `!.env.ops.example` for the committed template): `SUPABASE_ACCESS_TOKEN`,
  `VERCEL_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_DEV_PROJECT_REF`,
  `SUPABASE_PROD_PROJECT_REF`, `SUPABASE_DEV_DB_PASSWORD`,
  `SUPABASE_PROD_DB_PASSWORD`, `SUPABASE_DEV_SECRET_KEY` (the dev `sb_secret_…`,
  for admin-API scripts), `CRON_SECRET`. **The prod `sb_secret_…` key is not
  stored on disk by default**; when a task needs it, it is fetched with
  `supabase projects api-keys` for that task and not written down.
  `apps/web/.env.local` keeps exactly its two `NEXT_PUBLIC_*` names, now
  pointing at dev. The web app never sees a secret key, on either project —
  grep-enforced today, kept that way.

- **D11 — CI is a GitHub Actions workflow running typecheck, lint and test on
  every push and PR.** Vercel builds independently on push; the workflow is
  the part Vercel does not do (tests). Free on a public repo.

- **D12 — The spec moves, in four places, in Phase 4.** `ARC-012` reads
  "Phase 3: hosted backend, still dev/staging, not production." The owner's
  request of 2026-09-07 defines the step past it — hosted, friends using it,
  still free-tier, still "early access" per ARC-001. `ARC-006`'s open "email
  flavor" question (§6 item 7) is resolved: password for early access, code +
  reset for full release. `UX-002` gains the D8 carve-out as a dated owner
  ruling. §7 "Current dev phase" becomes vision Phase 3. `design-stack.md` §4
  rule 5 (vendor count) is **not** amended. `vision.md` is the owner's; if the
  owner wants the "hosteado mas ainda de dev" sentence to say more, that edit
  is theirs.

---

## 4. Phase 0 — Owner-only steps, in one sitting

Everything an agent cannot do because it needs a human's browser, identity, or
account. Do them in this order; the whole list is roughly 35 minutes plus one
short wait in the middle (the agent creating the projects). Hand each value to
the agent by pasting it into the named file — never into chat.

**About the links below.** Every step has a direct URL that lands on the exact
page, so the vendor's menus never need to be navigated. Supabase and Vercel are
English-only; the Google Cloud console follows the language of the Google
account, so its labels are given in English with the Portuguese label beside
them where it is known — when a label differs, the page the link opens is
still the right one and the button described is the only one of its kind on
that page. The Google links are pinned to the Cloud project `sl-fake-bets`
(the one that owns the existing OAuth client `898339473490-…`) with
`?project=sl-fake-bets`, so no project switching is needed.

**Before starting:** confirm the browser is signed into the **`pasilvadev`**
GitHub identity (the repo's remote is the `github-pessoal` account), and into
the Google account that owns that Cloud project. Both Vercel and Supabase will
offer "Continue with GitHub" — use it, with that identity. Expect each vendor to
ask for email confirmation, possibly a CAPTCHA, possibly a 2FA nudge; neither
needs a card.

**A. Decisions (write the answers at the top of `.env.ops` as comments, or tell
the agent):**

1. **D9** — `locale-pt-br` ON for the alpha (recommended) or OFF.
   **Done 2026-09-07: ON.**
2. **D2** — confirm the two Supabase project names and the Vercel project name
   (`sl-fake-bets-dev` / `sl-fake-bets` / `sl-fake-bets`), or pick others.
   **Done 2026-09-07: names confirmed as written.**
3. **D12** — acknowledge that this plan is the ARC-013 order for the 2→3 move
   *and* the step past ARC-012's "still dev/staging" wording.
   **Done 2026-09-07: acknowledged.**

**B. Accounts and tokens:**

4. **Supabase.** Sign up at <https://supabase.com/dashboard/sign-up> with
   GitHub. A personal organization is created automatically — there is no
   "create an org" step. If a plan chooser appears, pick **Free**; it will not
   ask for a card. Then open <https://supabase.com/dashboard/account/tokens>
   → **Generate new token**, name it `sl-fake-bets agents`, copy it once (it is
   shown once) and paste it as `SUPABASE_ACCESS_TOKEN=` in `.env.ops`. Do not
   create projects by hand — the agent does that, so the refs, passwords and
   keys land in the right files.
5. **Vercel.** Sign up at <https://vercel.com/signup> with GitHub, **Hobby**.
   Then open <https://vercel.com/account/tokens> → **Create**: name
   `sl-fake-bets agents`, scope = your personal account, expiry of your
   choosing (it can be revoked after Phase 3); paste it as `VERCEL_TOKEN=` in
   `.env.ops`.
6. **Vercel's GitHub App on the repo** — the one Git-integration step with no
   CLI. Open <https://github.com/apps/vercel/installations/new>, choose the
   `pasilvadev` account, **Only select repositories** → `sl-fake-bets` →
   Install. (If it is already installed, the same link shows **Configure**;
   add the repo there.) If you skip this, the agent's first `vercel git
   connect` prints this same URL and stops until you open it.

**→ Hand-off point.** Tell the agent Phase 0 A–B is done. Within about ten
minutes it creates both Supabase projects and the Vercel project and reports
three values back to you: the **dev project ref**, the **prod project ref**,
and the **production hostname**. Part C needs them.

**C. Google Cloud console (Google Auth Platform) — three pages, pinned:**

7. **Clients** — <https://console.cloud.google.com/auth/clients?project=sl-fake-bets>
   (pt-BR label: *Clientes*). Click the existing client (`898339473490-…`,
   type Web application). Under **Authorized redirect URIs** (pt-BR: *URIs de
   redirecionamento autorizados*) → **Add URI** → paste
   `https://<dev-ref>.supabase.co/auth/v1/callback`. Leave the JavaScript
   origin (`http://localhost:3000`) as is. **Save**.
8. **Audience** — <https://console.cloud.google.com/auth/audience?project=sl-fake-bets>
   (pt-BR label: *Público-alvo*). Confirm **User type** is **External**
   (*Externo*). In the **Publishing status** card the one button reads
   **Publish app** — click it and read the dialog:
   - If it publishes with only the app name, support email and developer
     contact filled → done. Note "Publish: no links required" for the agent.
   - If it insists on a homepage and privacy-policy URL: come back to this step
     after Phase 3 step 2 (the production URL exists then) and use
     `https://<prod-host>` and `https://<prod-host>/privacy` on the **Branding**
     page (<https://console.cloud.google.com/auth/branding?project=sl-fake-bets>).
     If its **Authorized domains** field rejects the `vercel.app` hostname,
     tell the agent — D7's fallbacks apply and the choice between them is
     yours. Until then the alpha runs password-only via the `auth-google`
     flag; nothing waits.
   - Do **not** submit for brand verification; not needed (§2.2).
9. **Clients again** — same link as step 7 → **Create client** → Application
   type **Web application** (*Aplicativo da Web*), name `SL — production`,
   **Authorized JavaScript origins** → `https://<prod-host>`, **Authorized
   redirect URIs** → `https://<prod-ref>.supabase.co/auth/v1/callback` →
   **Create**. Copy the client ID and the client secret from the dialog and
   paste them as `SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID=` /
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_SECRET=` in `supabase/.env`. Do not
   download the JSON into the repo folder; if you do, it is gitignored
   (`client_secret*.json`), but the existing one in the repo root should be
   moved out of the working tree anyway (hygiene, not a leak — it was never
   committed).

**D. Optional, when convenient:**

10. A friend willing to be the first real sign-up on their own phone — Phase 3
    uses that to observe what a stranger sees. Nothing to prepare; just ask
    them.
11. Nothing else. Every remaining step in this plan is an agent's.

**What the owner types, total:** two `.env.ops` lines, two `supabase/.env`
lines, one redirect URI, and answers to three decisions. Everything else is
clicks on the linked pages.

---

## 5. Phases

Each phase is sized for one fresh agent session and is executable from this
document alone. Phase 1 needs nothing from Phase 0 and can start immediately;
Phases 2–5 need Phase 0 A–B; Phase 3 step 3 needs Phase 0 C.

### Phase 1 — Hosting-ready code (no accounts needed)

**Goal:** make the tree deploy-correct and alpha-polished before any vendor
exists, so Phase 2 is configuration, not debugging. Every change here is
verifiable with `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and
a local `next dev` — no Docker, no hosted project.

**Tasks:**

1. **`supabase/config.toml`** — `[auth.external.google] skip_nonce_check = false`
   and delete the local-only comment (D7); `[api] auto_expose_new_tables = false`
   (matches the cloud default so any future local run exercises the same
   grants); `additional_redirect_urls` = the union in D5 with `<prod-host>` and
   `<vercel-scope>` as `env()` placeholders resolved in Phase 2; a
   `[remotes.production]` block (D5) with `project_id = "env(SUPABASE_PROD_PROJECT_REF)"`
   and nested `[remotes.production.auth] site_url = "env(NEXT_PUBLIC_SITE_URL)"`
   plus `[remotes.production.auth.external.google]` pointing at the `_PROD_`
   env names. Leave `[auth.email]` exactly as it is — `enable_confirmations =
   false` is the setting D1 relies on — and leave the `[auth.email.template.magic_link]`
   block in place with a one-line comment: dormant until full release (§8).
   Every `env()` name is listed in a new `supabase/.env.example`. **The base
   `site_url` stays `http://localhost:3000`** — that is dev's correct value.
2. **Feature flag migration** (D9): `2026090712xxxx_alpha_flags.sql` — flip
   `locale-pt-br` to `true` if the owner confirmed, and `insert … on conflict
   (key) do update set description` a new `auth-google` flag seeded `true`
   (the `on conflict` shape from `duel_schema.sql:390`, which deliberately does
   not overwrite `enabled`). Add `"auth-google"` to `KnownFeatureFlag` in
   `packages/shared/src/infra.ts` with a comment saying what it is for: an
   ops kill switch for a login method whose availability depends on a
   third party's console, not a feature gate.
3. **Env guard** — one `apps/web/src/lib/supabase/env.ts` exporting
   `supabaseEnv()` that reads the two `NEXT_PUBLIC_SUPABASE_*` values and
   throws `Missing NEXT_PUBLIC_SUPABASE_URL — see supabase/README.md §Hosted`
   when absent; `client.ts`, `server.ts` and `proxy.ts` call it instead of `!`.
4. **Keep-alive route** (D4) — `apps/web/src/app/api/keepalive/route.ts`:
   rejects unless `Authorization: Bearer ${process.env.CRON_SECRET}` matches
   (401), otherwise awaits `smokeTest()` and returns `{ ok, flagCount }` with
   `Cache-Control: no-store`. `apps/web/vercel.json`:
   `{ "crons": [{ "path": "/api/keepalive", "schedule": "0 9 * * *" }] }`.
   `robots.ts` disallows `/api/`. Add `api/` to the `proxy.ts` matcher's
   exclusions — a cron request carries no session and should not spend the
   refresh path.
5. **The auth screen becomes sign in / create account** (D1, D6, D8). Rewrite
   `auth-page.tsx`'s two steps (`landing` | `otp`) as two modes on one card,
   `signIn` | `createAccount`, switched by a text link under the form ("New
   here? Create an account" / "Already have an account? Sign in"), default
   `signIn` unless `?mode=create` or the visitor arrived from `/join/[code]`
   (an invite is almost always a new person — `AuthPage` already knows the
   pathname). **Sign in:** email, password, one button →
   `signInWithPassword`. **Create account:** display name (required, the
   first field, `autoFocus`, `autoComplete="nickname"`), email, password
   (`autoComplete="new-password"`, minimum 6, no other rule) →
   `signUp({ email, password, options: { data: { display_name } } })`; because
   confirmations are off the response carries a session and the existing
   `router.replace(destination)` path runs unchanged. The `?next=` /
   pathname destination handling, `AuthGated` in-place swap and the Google
   button all stay; the Google button renders only when
   `useFeatureFlag("auth-google")` is true (task 2). **Removed:** the OTP
   step, `verifyOtp`, the resend cooldown, the `devMailpit` string and its
   `NODE_ENV` block, `otpTitle`/`otpLead`/`codeSent` and every other OTP
   message key (in both catalogs — the exhaustive `Messages` type will name
   any straggler). **Validation** in `packages/shared/src/validation.ts`: a
   `validateSignupDraft({ displayName, email, password })` reusing
   `display-name-required`, adding `email-invalid` and `password-too-short`
   (with `values: { min }`), plus a vitest file beside it — the first test for
   a validator this plan adds. **Errors:** `auth-page.tsx:103/:131/:153` stop
   rendering `error.message`. Map GoTrue codes — `invalid_credentials`,
   `user_already_exists`/`email_exists`, `weak_password`, `validation_failed`,
   `over_request_rate_limit`, `signup_disabled`, network failure — to
   `MutationErrorCode` values, adding the new codes to
   `packages/shared/src/errors.ts` and their sentences to both catalogs under
   `errors` (the exhaustive `Record` makes an omission a typecheck failure).
   Read the code names from `node_modules/@supabase/auth-js`'s error-code
   list, not from memory. Log the raw message with `console.error`, as D9 of
   the i18n plan does for SQL. **Copy** follows `design-visual-identity.md`
   §7: the create-account lead says the display name is what teammates will
   see and can be changed later; nothing says "verify", "confirm" or
   "inbox". The auth page footer gains the build tag (task 7) and the privacy
   link (task 8).
6. **Root `error.tsx`** — `apps/web/src/app/error.tsx` in the house style
   (`design-visual-identity.md` §5.10 empty/ghost pattern, §7 voice): one
   dry sentence, a "Try again" that calls `reset()`, the build tag from task
   7. Strings in `messages/*.json` under `errorPage`.
7. **Build tag** — `apps/web/src/lib/build-info.ts` reading
   `process.env.NEXT_PUBLIC_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA`
   (the `NEXT_PUBLIC_` copy is set by `next.config.ts`'s `env` from the Vercel
   var at build time so the client can read it); the first seven characters
   render in the profile menu's footer row and on the auth page footer, mono,
   `text-muted`. Empty locally. Not an alpha banner (D8).
8. **`/privacy`** — `apps/web/src/app/privacy/page.tsx`, server-rendered,
   indexable, added to `sitemap.ts`. Plain language, under 400 words: what is
   stored (email and a password hash, or Google profile basics; display name;
   avatar; bets, wagers and chat within a team), that the email address is
   not verified, where the data lives (Supabase and Vercel, named honestly as
   processors), that coins have no monetary value, that a team leader can
   remove members, how to delete an account (email the owner — no self-serve
   deletion exists and none is built here), no analytics beyond the two
   ARC-017 metrics, no ads. `privacy` namespace in both catalogs (pt-BR
   follows the flag). Linked from the auth page footer beside the `EN · PT`
   pair. **Not legal advice; the owner reads it before Phase 3.**
9. **Small hardening** — `dashboard-page.tsx:33` `100vh` → `100svh`; a new
   migration adding `check (pg_column_size(properties) <= 4096)` on
   `analytics_events` (the writer never sends more than a step name and a
   code); `apps/web/package.json` gains `"engines": { "node": "22.x" }`.
10. **Ops scripts** (D3) — `scripts/db-push-prod.sh` (the guard described in
    D3, `set -euo pipefail`, sources `.env.ops`, refuses to run if the linked
    ref in `supabase/.temp/project-ref` equals the prod ref),
    `scripts/supabase-privilege-audit.sql` (for every table in `public`:
    `has_table_privilege` for `anon` and `authenticated` on
    select/insert/update/delete; for every function in `public` and `app`:
    `has_function_privilege` for both roles — the expected matrix is the
    grants in the migrations, and the query prints only rows that deviate).
    Root `package.json` scripts: `db:push:dev` → `supabase db push --linked`,
    `db:push:prod` → `bash scripts/db-push-prod.sh`, `db:reset:dev` →
    `supabase db reset --linked`, `db:status` → `supabase migration list
    --linked`. `.env.ops.example` with every D10 name and an empty value;
    `.gitignore` gains `!.env.ops.example`.
11. **CI** (D11) — `.github/workflows/ci.yml`: checkout, `pnpm/action-setup@v4`
    pinned to 11.25.0, `actions/setup-node@v4` with `22.19.0` and pnpm cache,
    `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
    `pnpm test`. No deploy step — Vercel's Git integration deploys.

**Exit criteria:**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; CI green on
  the push; the new validator's tests run and pass.
- `next dev` with the two `NEXT_PUBLIC_SUPABASE_*` values blank renders the
  task-3 message, not a stack trace from `@supabase/ssr`.
- `grep -rn "otp\|Otp\|OTP\|Mailpit\|mailpit" apps/web/src apps/web/messages`
  returns nothing but the dormant-template comment, if that.
- The auth screen, forced into each mapped error, shows a catalog sentence in
  both locales and the raw SDK text appears only in the console; submitting
  create-account with a blank display name is refused inline before any
  request leaves the browser.
- `curl -i localhost:3000/api/keepalive` → 401; with the bearer header → 200
  and `{ ok: false, … }` against a dead stack (the route itself works; the
  query result is Phase 2's job).
- Throwing inside a client component renders the new `error.tsx`, not Next's
  default.
- `/privacy` is server-rendered HTML with an `<h1>`, listed in
  `/sitemap.xml`, linked from the signed-out page.
- `bash scripts/db-push-prod.sh` with `.env.ops` absent exits non-zero with a
  one-line reason before touching the network.
- `supabase/.env.example` and `.env.ops.example` name every variable the
  phases below read; `grep -rn "SERVICE_ROLE\|sb_secret" apps/web` is still
  empty.

**Sizing:** ~18 files — `config.toml`, two migrations, `infra.ts`, `errors.ts`,
`validation.ts` + its test, `en.json`, `pt-BR.json`, `env.ts`,
`client.ts`/`server.ts`/`proxy.ts`, `api/keepalive/route.ts`, `vercel.json`,
`robots.ts`, `sitemap.ts`, `auth-page.tsx`, `error.tsx`, `build-info.ts`,
`next.config.ts`, `profile-menu.tsx`, `privacy/page.tsx`, `dashboard-page.tsx`,
two scripts, two example env files, `.gitignore`, root `package.json`,
`apps/web/package.json`, `ci.yml`. Honestly counted that is nearer 30, most of
them one-line edits. **If the session runs long, split at tasks 1–4 + 10–11 /
5–9**: the first half is what Phase 2 needs; the second half is what Phase 3
needs, and task 5 is the largest single item — budget half the session for it.

**Risks:** GoTrue error-code names — read them from the installed package. The
`[remotes.*]` syntax — read the CLI's own `config.toml` reference for v2.116
before writing it; if the CLI rejects the block, keep the base file valid and
let Phase 2 use the D5 fallback. The sign-in/create toggle is where a
"release-like" screen is won or lost: a friend who types a password into
sign-in for an account that does not exist must read a sentence that points
at "Create an account", not `invalid_credentials`.

### Phase 2 — Provision and wire (needs Phase 0 A–B) **[ARC-013: owner order required]**

**Goal:** both Supabase projects and the Vercel project exist, hold the full
schema and the auth configuration, and a preview deployment of `main` runs
against dev. Nothing is public yet: the production environment is created but
its `site_url` still points at a placeholder until Phase 3.

**Tasks:**

1. **Load `.env.ops`** (`set -a; source .env.ops; set +a`). `supabase orgs
   list` → `SUPABASE_ORG_ID`. Generate two 32-character passwords
   (`openssl rand -base64 32 | tr -d '/+='`) into `SUPABASE_DEV_DB_PASSWORD`
   and `SUPABASE_PROD_DB_PASSWORD` in `.env.ops`.
2. **Create the projects:** `supabase projects create sl-fake-bets-dev --org-id
   … --region sa-east-1 --db-password "$SUPABASE_DEV_DB_PASSWORD"`, then the
   same for `sl-fake-bets`. `supabase projects list` → both refs into
   `.env.ops`. Wait for status `ACTIVE_HEALTHY`. `supabase projects api-keys
   --project-ref <dev>` → the publishable key into `apps/web/.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL=https://<dev-ref>.supabase.co`, the key into
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`), the secret key into
   `SUPABASE_DEV_SECRET_KEY`. Fetch prod's publishable key for step 8; do not
   write prod's secret key anywhere.
3. **Link to dev, forever** (D3): `supabase link --project-ref <dev-ref> -p
   "$SUPABASE_DEV_DB_PASSWORD"`. Confirm `supabase/.temp/project-ref` holds the
   dev ref. This is the last time a ref is typed into `link`.
4. **Migrations to dev, then audit:** `supabase db push --linked --dry-run`,
   read the list (all 21 + Phase 1's two), `supabase db push --linked`.
   Run `scripts/supabase-privilege-audit.sql` against dev (Studio SQL editor
   or `psql` with the dev password); it must print zero deviations. Then:
   `select * from pg_publication_tables where pubname = 'supabase_realtime'`
   → `bets, wagers, comments, chat_messages, bet_duels`; `select jobname from
   cron.job` → `prune-chat-messages` (or the migration's `raise notice` was
   logged — either is acceptable, the read path enforces retention);
   `select id, public, file_size_limit from storage.buckets` → `avatars`,
   `true`, 2 MiB.
5. **Seed dev:** `pnpm db:reset:dev` (prompt: yes — this is dev, and the
   linked ref was just verified). Confirm `select count(*) from auth.users`
   = 10, then sign in **through the new form** from a local `next dev` as
   `rafa@sl.local` / `slfakebets` — the fixtures exercise the real sign-in
   path now, no mail, no admin API. The password grant over `curl` still
   works for headless harness use.
6. **Vercel project:** `npm i -g vercel`; from `apps/web`: `vercel link --yes
   --project sl-fake-bets --token "$VERCEL_TOKEN"`. `vercel whoami` → the
   scope slug. `vercel api /v9/projects/<id> -X PATCH -d
   '{"rootDirectory":"apps/web","nodeVersion":"22.x","autoExposeSystemEnvs":true}'`.
   Env vars via `printf '%s' "$V" | vercel env add NAME <env>`:
   - all three environments: `ENABLE_EXPERIMENTAL_COREPACK=1`;
   - `production`: `NEXT_PUBLIC_SUPABASE_URL` (prod), `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (prod publishable), `CRON_SECRET` (32 random chars, also into `.env.ops`),
     `NEXT_PUBLIC_SITE_URL` — filled after step 7 reports the hostname;
   - `preview` and `development`: the dev URL and dev publishable key.
   `vercel git connect --yes` — prints the GitHub authorization URL if the
   App is not installed yet; **stop and ask the owner to open it** (Phase 0
   step 6), then re-run.
7. **First preview deploy:** push `main` (or `vercel deploy` from `apps/web`).
   If the build fails on pnpm: set `installCommand` to
   `corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile`
   via the same `PATCH`; if that fails, `npx -y pnpm@11.25.0 install --frozen-lockfile`;
   only if both fail, propose pinning the repo to pnpm 10.x to the owner. If
   the build fails on `@repo/shared` not found, set `buildCommand` to
   `cd ../.. && turbo run build --filter=web`. Read the production hostname
   from `vercel project ls` / the dashboard and write
   `NEXT_PUBLIC_SITE_URL=https://<prod-host>` into Production. Report the
   **dev ref, prod ref and prod host to the owner** — Phase 0 part C is now
   unblocked.
8. **Auth config to both projects** (D5, D7): with `supabase/.env` holding the
   Google values, `supabase config push --project-ref <dev-ref>` then
   `--project-ref <prod-ref>`. Verify in each project's Dashboard
   (Authentication → URL Configuration, → Providers → Google, → Sign In /
   Providers → Email) that `site_url`, the allow-list, the Google client,
   `skip_nonce_check = false`, email provider **on**, "Confirm email" **off**
   and minimum password length 6 landed with the right per-project values. If
   `[remotes.production]` did not apply, `PATCH /v1/projects/<prod-ref>/config/auth`
   with `site_url`, `uri_allow_list`, `external_google_client_id`,
   `external_google_secret` from a small script, and record in this document
   which path worked. **Prod's Google provider gets the production client
   (Phase 0 step 9); if that step is not done yet, push without Google on prod
   and repeat after.**
9. **The first real account:** from a local `next dev` pointed at dev, create an
   account with the owner's address, a password and a typed display name; the
   session arrives with no email sent; a fresh account lands on
   `NoTeamsScreen`; the profile step shows the typed name with "looks good" as
   the primary action (provider-quality prefill, §2.5). Sign out, sign back
   in with the password. Then, still on localhost, "Continue with Google" with
   the dev client (Phase 0 step 7) round-trips.
10. **Realtime on hosted:** two browsers against dev (one via a seeded
    account, one via the owner's), one team, a wager placed in A appears in B
    without refresh.

**Exit criteria:**

- `supabase migration list --linked` shows every migration applied on dev;
  `scripts/db-push-prod.sh` in `--dry-run` mode against prod lists the same
  set as pending (prod is pushed in Phase 3, after the owner's go).
- The privilege audit prints zero deviations on dev.
- A preview deployment of `main` is green and, opened by the owner (Vercel
  login wall), shows the signed-out page with the build tag.
- Both projects show identical auth configuration except `site_url` and the
  Google client.
- Password create-account, sign-out, sign-in and Google sign-in all work
  against dev from localhost; the daily reward and onboarding grant appear as
  they do locally; Supabase's Auth logs show **zero** emails attempted.
- Realtime propagates between two devices on the hosted dev project.
- No prod secret key exists on disk (`grep -r sb_secret .env.ops supabase/.env`
  shows only the dev key).

**Sizing:** almost no files — `.env.ops`, `apps/web/.env.local`, `supabase/.env`
(all gitignored), possibly a fallback script for D5, plus edits to this
document recording what actually happened. Budget the session for
**waiting and verifying**, not writing: project provisioning and DNS-less
deploys each take minutes, and the pnpm-11 build risk may cost two or three
build cycles.

**Risks:** the pnpm 11 build (mitigation order in task 7); `[remotes]` not
applying (fallback in task 8); the Data API grants (the audit catches a miss
before any user does).

### Phase 3 — Go live and verify on real devices (needs Phase 0 C)

**Goal:** production exists at its public URL, the owner has created the first
real team, and every claim this plan makes about a stranger's experience has
been observed on a stranger's device rather than inferred.

**Tasks:**

1. **Schema to prod:** `pnpm db:push:prod` — read the dry-run list, type
   `prod`. Run the privilege audit on prod. **Never `db reset`, never
   `--include-seed`, never `link` — say it once more here because this is the
   first moment the guard is load-bearing.**
2. **Production deploy:** `vercel deploy --prod` from `apps/web` (or a push to
   `main` once `git connect` is live). Open `https://<prod-host>`: the
   signed-out page, the privacy link, the build tag; `curl -sI /robots.txt`,
   `/sitemap.xml`, `/api/keepalive` (401). Confirm `og:url` in the served HTML
   is the production origin, not `localhost`. Report the host to the owner if
   Phase 0 step 8 is waiting on it.
3. **Google on prod** (after Phase 0 step 9): `supabase config push
   --project-ref <prod-ref>` (or the D5 fallback) with the production client;
   verify the Dashboard shows the new client ID and `skip_nonce_check` off.
4. **Cron:** confirm in the Vercel dashboard (Settings → Cron Jobs) that the
   daily job is registered; trigger it once by hand (the "Run" control) and
   see a 200 with `flagCount` ≥ 7 in the function logs — that is a real
   `feature_flags` read counted as activity.
5. **Stranger's password sign-up:** from a phone, on mobile data, an address
   that is not the owner's: create an account with a typed display name, land
   on `NoTeamsScreen`; kill the browser, reopen the URL — still signed in
   (ARC-007). Check that the phone's password manager offered to save the
   password (the `autoComplete` attributes from Phase 1 task 5 are what make
   that happen).
6. **Stranger's Google sign-in:** same phone, a Google account that is **not**
   the owner's: tap "Continue with Google". Record exactly what the consent
   screen says (app name vs `<ref>.supabase.co`, any warning). If a warning
   or a Testing-mode refusal appears, Publish did not take — go back to Phase
   0 step 8 and D7's fallbacks, and flip `auth-google` off in prod's Studio
   until it is resolved (no deploy needed; the alpha is complete without it).
7. **The first team:** the owner signs in on prod, creates the real team,
   copies the invite link, opens it on the phone from step 5: join lands in
   the join modal (UX-012), the grant appears, the dashboard shows both
   members. Place one wager on each device; watch it arrive on the other.
   Send one chat message each way.
8. **Social cards, finally against a real unfurler** (`plan-mvp-roadmap.md`
   Phase 9's "first thing to re-check"): paste the invite link and a bet
   link into WhatsApp and one of Slack / Discord / Telegram; each renders the
   team name or the bet title with live odds. If WhatsApp shows nothing, check
   that `og:image` is either absent or absolute — WhatsApp drops cards with a
   relative image.
9. **Avatar upload on prod** from the phone: a 1 MB JPEG succeeds, a 3 MB one
   is refused with the catalog sentence.
10. **Preview sanity:** open the latest preview URL (Vercel login) and confirm
    it reads dev data, not prod — the environment split is the single most
    expensive thing to get wrong later.
11. **Hand the link to the friends.** Nothing in the product says alpha; the
    owner's message to the group can — and it should say "no password reset
    yet: use Google or ask me" (D1), so the first person who forgets is not
    surprised.

**Exit criteria:**

- Two genuinely different people, on two devices, one via password and one via
  Google, are members of the same production team and see each other's
  wagers live.
- WhatsApp renders both card types from the production URL.
- The cron has run once by hand and once on schedule (check the next day).
- Prod's `auth.users` contains only real people; `select count(*) from
  public.teams` is 1; no `@sl.local` address exists there; Supabase's Auth
  logs on prod show zero email attempts.
- `vercel env ls` shows the production/preview split exactly as D2 says.

**Sizing:** zero code unless verification finds a defect; every defect found
here goes to `agent-docs/found-bugs.md`'s owner list or is fixed in a follow-up
commit. Budget half a session for the walkthroughs and the other half for
whatever they find.

**Risks:** Google Publish (D7 fallbacks; the `auth-google` flag means the alpha
does not wait on Google); Realtime on Nano under a real group (observe during
the first evening; `design-realtime.md` §6 holds the escalation triggers); a
friend forgetting a password in week one (D1's answer, said up front in step
11).

### Phase 4 — The Docker-free loop and the documents that describe it

**Goal:** the owner's daily development needs no container, is documented in
one place, and every agent-doc that described the local-only world tells the
truth about the hosted one.

**Tasks:**

1. **`apps/web/.env.local`** points at dev (done in Phase 2); confirm `pnpm
   dev` works from a cold Mac with Docker not installed at all: sign in as a
   seeded fixture through the form, use the app.
2. **`supabase/README.md`** — rewrite around the new shape: a "Hosted" section
   first (two projects, which is linked, the four `pnpm db:*` scripts, the
   prod guard and *why* the prompt cannot be trusted, where each secret lives
   per D10, how to get a session as an agent on dev — the seeded fixtures
   through the form or the password grant, or `auth.admin.createUser` with
   `SUPABASE_DEV_SECRET_KEY`, never on prod — how the owner reads prod logs
   (Dashboard → Logs, one-hour Vercel retention, so look the same day), how
   to flip a flag in hosted Studio, how to reset a friend's password in
   Studio, how to resume a paused dev project); then the existing "Running it
   locally with Docker" section demoted to an appendix headed "Only if you
   ever need the full stack offline again", with the Mailpit caveat replaced
   by: "no email is sent in early access; the OTP template is dormant until
   full release". Keep "Things that will bite you"; add the reset-prompt trap
   and the `--include-seed` trap.
3. **`design-stack.md`** — §1 hosting rows (Phase 3 reached, date) and the
   Auth row ("email + password, unverified, + Google for early access; OTP
   code and reset return with an SMTP vendor at full release — see
   `plan-hosted-early-access.md` §8"), §4 rule 5 unchanged, §5 (keep-alive →
   Vercel cron per D4; Google OAuth bullet corrected per §2.2 — no
   "unverified app" warning for non-sensitive scopes once published; the
   magic-link bullet marked suspended).
4. **`design-scale-and-free-tier.md`** — §0 "where the app actually is"
   (hosted, two free projects, since <date>), §2.6 names the Vercel cron, §3
   order unchanged, §5's "before the ARC-012 transition" item marked done with
   the 2026-09-07 re-verification deltas (template lock, Data-API exposure,
   publishable keys, 1-year restore, the mailer's recipient restriction).
5. **`AGENT_SPEC.md`** (D12) — §4.3 ARC-012 gains a dated note that the hosted
   early access with friends began on <date> under this plan; ARC-006 gains
   the resolution of §6 item 7; UX-002 gains the D8 carve-out as a dated owner
   ruling; §7 "Current dev phase" becomes vision Phase 3; the ARC-013 sentence
   stays. Ask before touching any requirement's tag.
6. **`plan-mvp-roadmap.md`** — one pointer line after §8: "Hosting: see
   `plan-hosted-early-access.md`." and a one-line note under §4.1 that the OTP
   decision is suspended for early access by that plan's D1. Nothing else;
   that document is closed.
7. **Retire the local artifacts that lie now:** the `client_secret_*.json` in
   the repo root moves out of the working tree (owner's file, agent asks);
   `supabase/.temp` stays gitignored; the memory note "Local stack runbook"
   gets a pointer to the README's hosted section.

**Exit criteria:**

- A fresh clone plus the two example env files filled in runs `pnpm dev`
  against dev with no Docker anywhere (ARC-002).
- Every document above states the hosted shape; `grep -rn "GitHub Actions
  cron" agent-docs` returns only historical notes that say they were
  superseded; `grep -rn "Mailpit" supabase/README.md` hits only the Docker
  appendix.
- `supabase/README.md`'s first screen answers "how do I push a migration to
  prod and how do I make sure I never reset it".

**Sizing:** ~6 files, all prose. One session.

### Phase 5 — The first week

**Goal:** know, rather than hope, that the free-tier ceilings and the pause
rule behave as documented for this specific deployment.

**Tasks:**

1. **Day 2:** the scheduled cron fired (Vercel → Cron Jobs → last run) and
   Supabase's Dashboard shows API requests on prod for that hour.
2. **Day 3–4:** Supabase → Reports on prod: egress, DB size, realtime
   connections, auth MAU — all a rounding error against §2.3; record the
   numbers in `design-scale-and-free-tier.md` §0 as the hosted baseline
   (the local baseline was 12 MB).
3. **Pause drill, on dev:** leave dev untouched for 7 days (or pause it from
   the Dashboard), open a local `next dev` against it — the app degrades to
   signed-out with no crash (fail-soft is the coded behavior); Resume from the
   Dashboard; time it; note that the publishable key is unchanged after
   restore (projects restored after 2025-11-01 do not get legacy keys, which
   is fine here).
4. **`found-bugs.md`:** the owner's list, as always. Agents fix from there.
5. **Auth:** Supabase → Authentication → Users on prod: every row has
   `email_confirmed_at` set (autoconfirm) and a display name that is not
   "Player" — if one is, D8's required field leaked somewhere.
6. **Vercel:** Usage → confirm function invocations and Active CPU are far
   below Hobby; if `proxy.ts` invocations dominate, that is expected — one per
   navigation.

**Exit criteria:** the numbers are written down, the drill was run once, and
nothing paged the owner. Then this plan is complete and
`design-scale-and-free-tier.md` §5 governs re-reads.

---

## 6. Verification checklist (the whole plan, in one list)

Run against the real hosted stack, not inferred:

1. Google consent screen: Publish accepted; a non-owner Google account sees
   no warning and no Testing refusal (Phase 3 step 6).
2. Password create-account by a non-owner on their own phone, with a typed
   display name, no email sent (Phase 3 step 5); the same on dev from
   localhost first (Phase 2 step 9).
3. Google sign-in from a friend's phone (Phase 3 step 6).
4. Realtime between two devices on Nano (Phase 2 step 10, Phase 3 step 7).
5. WhatsApp and one other unfurler render both card types (Phase 3 step 8).
6. Pause and resume on dev, timed (Phase 5 step 3).
7. The cron demonstrably hits the database (Phase 3 step 4, Phase 5 step 1).
8. The prod-push guard refuses without env, prints the target, requires
   `prod` typed (Phase 1 exit criteria, Phase 3 step 1).
9. Both `NEXT_PUBLIC_SUPABASE_*` values set in all three Vercel environments;
   a preview reads dev (Phase 3 step 10).
10. A genuinely fresh user's path on prod: create account → `NoTeamsScreen` →
    join by link → grant → dashboard (Phase 3 step 7).
11. The privilege audit prints zero deviations on both projects (Phase 2 step
    4, Phase 3 step 1).
12. `grep -rn "sb_secret\|SERVICE_ROLE" apps/web` is empty after every phase.
13. Supabase Auth logs on both projects show zero email attempts (Phase 2 and
    Phase 3 exit criteria).

---

## 7. Risks

1. **Unverified emails.** A friend can create an account with another
   friend's address, and if that friend later signs in with Google using the
   same address, Supabase links the Google identity to the existing
   (autoconfirmed) account. In a friend group this is a prank, not a breach,
   and ARC-008 accepts it; the full release's verification closes it. If it
   happens, the owner deletes the impostor row in Studio.
2. **No password reset in the alpha.** D1's answer is Google or the owner. Said
   in the owner's launch message (Phase 3 step 11) so nobody discovers it
   alone. The full release brings the reset flow with its SMTP vendor.
3. **Google Publish requiring a domain.** Unverifiable from documentation;
   resolved by a click in Phase 0 step 8; D7's `auth-google` flag keeps the
   alpha independent of the answer, and with D1 a password-only alpha is a
   complete one.
4. **pnpm 11 on Vercel.** Outside the documented support table; loud failure;
   three mitigations in order (Phase 2 task 7). Do not downgrade the repo's
   pnpm before the first two are tried.
5. **`[remotes.*]` overrides in `config.toml`.** The CLI documents them for
   branching; whether `config push --project-ref` honors them for a plain
   second project is verified on dev first, with the Management API as the
   fallback (D5).
6. **The reset footgun.** Mitigated by D3, which is discipline encoded as a
   script, not a habit. The one behavior that would defeat it — someone
   typing `supabase link --project-ref <prod-ref>` — is why the README's first
   screen says never to.
7. **Two-project quota is the ceiling.** A third free project (a second
   friend group's isolated instance, a staging clone) means pausing or
   deleting one. Not a problem today; recorded so it is not a surprise.
8. **Vercel Hobby's non-commercial clause is a product constraint.** Donations
   are exempt; ads, affiliate links or a paid contributor are not. Any of
   those forces Pro (US$20/mo) — `design-scale-and-free-tier.md` §4.4.
9. **One-hour Vercel log retention.** A friend's "it broke last night" cannot
   be investigated from Vercel logs; Supabase's API/DB logs keep one day.
   Ask for a screenshot and the build tag (D8) instead.
10. **Realtime on Nano.** Comfortably within quota on paper (§2.3); the RLS-check
    connection pool on the smallest compute is the one thing paper cannot
    settle. Observe the first live evening.
11. **Phase discipline.** Phases 2 and 3 create things outside this repo that
    cost nothing but cannot be `git revert`ed. Phase 2 does not start until
    the owner's Phase 0 hand-off, and Phase 3 step 1 (schema to prod) is the
    first irreversible-in-spirit act — the plan says so at that step.

---

## 8. Deferred to the full release, and what this plan deliberately does not do

**Registered for the full release (owner ruling 2026-09-07):**

- **Email-code login** (`plan-mvp-roadmap.md` §4.1's OTP decision, and
  `templates/magic_link.html`, kept dormant in the repo for it).
- **"Forgot password"** — Supabase's `resetPasswordForEmail` plus a
  `/auth/reset` route and a `recovery` template; needs the same SMTP.
- **Email verification** at sign-up, if the owner then wants addresses proven
  (§7 item 1 is what it buys).
- **The SMTP vendor** that all three need: Brevo per §2.1's table, or Resend
  once a domain exists. That is the moment the vendor count goes to three and
  `design-stack.md` §4 rule 5 is amended — not before.
- **Google brand verification** (cosmetic; wants a homepage and privacy URL on
  a domain the owner controls) and **a domain** — the first paid item worth
  its price: it fixes the consent screen, the URL friends type, and email
  deliverability for the items above in one purchase.

**Not done, and not deferred either — out of scope by design:**

- **Supabase Pro / Vercel Pro.** `design-scale-and-free-tier.md` §4 holds the
  triggers; none fires at friend-group scale.
- **A custom Supabase auth domain, PostHog, Sentry, Playwright.** Each is a
  vendor; the count is two.
- **Postgres Changes → Broadcast.** `design-realtime.md` §6's triggers govern.
- **Any feature** — donations, notifications, crowd resolution, native mobile,
  the icon set, an admin UI, a bug-report form, self-serve account deletion,
  password-strength rules. The exclusion list in `plan-mvp-roadmap.md` §6
  risk 7 stands, and the one new flag (`auth-google`) is an operational switch
  on an existing login method, not a feature.
- **Preview-URL OAuth testing.** Structurally impossible on Hobby (§2.4);
  stop trying.

---

## 9. Provenance

Written 2026-09-07 against `main` at `228bbbe` (clean); amended the same day
after the owner's D1/D8 rulings, against `74f3a8a`. Method: an inline scout of
the repo (config, migrations, auth code, docs), then a seven-agent research
pass — Supabase free tier and CLI; Supabase auth email and SMTP providers;
Vercel Hobby, monorepo, cron and Git integration; Google OAuth publishing;
codebase hosting readiness (with `typecheck`, `build`, `lint` and `test`
actually run against a dead local stack); the Docker-free local loop; product
readiness for a release-like alpha — each web-verified against vendor
documentation dated 2026-09-07. Fifty-five load-bearing claims then went
through an adversarial pass instructed to refute them; seven were refuted or
materially corrected and the corrections are what this document states: brand
verification is *not* needed to avoid Google's warning screen (the mechanism is
scope-gated); the Data-API exposure change does *not* retroactively break
existing projects' existing tables (it does apply to this brand-new project,
which the migrations already handle); `--project-ref` *does* exist on `db
push`/`db reset` in CLI 2.116.0 despite the reference page; the pnpm-11 failure
on Vercel is *loud*, not silent, and `ENABLE_EXPERIMENTAL_COREPACK` is *not* a
guaranteed fix; the CLI no longer *fails* on an unresolved `env()` (it warns,
and could push an empty secret — a different risk); and the "Google-only via
`enable_signup = false`" idea is *unverified*, not clean. A completeness critic
then added the owner's access token, the DB-password home, the GitHub-identity
check, the two-client OAuth merge, the permanent `skip_nonce_check` flip, the
preview-OAuth dead end and the Google-Publish domain question, all folded in
above.

The amendment replaced the first draft's D1 (Brevo as an owner-approved third
vendor for the alpha) with the owner's ruling — password login without
verification, code and reset deferred — after confirming in the repo that the
sign-up trigger already reads `display_name` from metadata
(`auth_profile_bootstrap.sql:41-53`, `onboarding_profile_step.sql:47-58`), that
`enable_confirmations = false` and `minimum_password_length = 6` are already set,
and that `validateProfileDraft` already owns `display-name-required`. Phase 0's
Portuguese labels were verified against Google's own pt-BR help pages where
stated (*Público-alvo*, *Externo*, *Nome do app*, *Clientes*); the direct URLs
and the `?project=` pin are what make the labels secondary. Vendor URLs cited in
§2 were fetched that day; treat every number as a snapshot and re-verify per
`design-scale-and-free-tier.md` §5.

Requirement anchors: ARC-001 (free tiers, ceilings documented), ARC-002 (fresh
clone, minimal accounts — two, both the owner's), ARC-003 (maintenance first:
two projects and one script over branching, profiles or a second config
mechanism; no mail pipeline to maintain in the alpha), ARC-005/UX-013 (realtime
verified on the hosted tier), ARC-006/007/008 (password + Google, long sessions
unchanged, verification deliberately deferred), ARC-012/013 (this plan *is* the
gated transition and says where the order lands), ARC-016 (one new flag,
operational), ARC-017 (no third metric — the build tag is not analytics),
UX-001/002/003/012/017/023/024/029 (self-signup with one required field on one
path, published consent screen, deep links, privacy page in the sitemap, cards
verified against a real unfurler).

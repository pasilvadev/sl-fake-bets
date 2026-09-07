# SL Fake Bets — Hosted Early Access Plan (ARC-012, and one step past it)

**Status: PLAN, written 2026-09-07. Not yet ordered.** This is the vision Phase 2→3
transition (`ARC-012`), which `ARC-013` says needs its own explicit, in-the-moment
owner order. §4 (Phase 0) is that order in practice: the moment the owner hands
an agent the tokens Phase 0 asks for, the transition is on. Nothing in Phases 1–5
runs before that.

**Owner requirement, stated 2026-09-07:** bring the app from the current local
Docker state to a hosted early access where a friend group can alpha test it —
friends sign themselves up, the UX is a release's UX (no alpha banner, no
"add me as a tester" step, no accounts created for them by hand), everything on
free-tier vendors, and the owner keeps developing on this Mac **without running
Docker containers**. Every step the owner must personally do is batched into
Phase 0 so agents can build the rest.

**One thing the owner should know before reading further.** The research behind
this plan found that the product's primary login — the 6-digit email code — does
not work on Supabase's built-in mailer for anyone outside the owner's own
Supabase team, at any volume (§2.1). Delivering codes to friends needs a custom
SMTP sender, which is a **third vendor** against `design-stack.md` §4 rule 5's
frozen count of two. Decision D1 asks for that approval and names the cheapest
option. There is no zero-vendor path to "friends sign up with an email code".

---

## 0. Scope, in one paragraph

Two Supabase Cloud free projects in one org — `sl-fake-bets` for friends, and
`sl-fake-bets-dev` as the owner's Docker-free daily driver and the target of
Vercel preview deployments — plus one Vercel Hobby project whose Production
environment points at the first and whose Preview environment points at the
second. Email-code login via Brevo's free SMTP relay, Google sign-in via a
published consent screen, a daily Vercel cron so the production project never
idles into a pause, a guarded prod-push script so the destructive CLI commands
can only ever reach dev, and a handful of small code changes that a release-like
alpha needs (a privacy page, friendly auth errors, an error boundary, a build
tag). No custom domain, no paid tier, no new features: the roadmap's scope-creep
exclusion list (`plan-mvp-roadmap.md` §6 risk 7) holds through every phase here.

---

## 1. Read first

**Docs.** `AGENT_SPEC.md` §4.3 ARC-001/002/003/012/013 (the constraints this
plan executes under) and §0 (doc protocol — this file is registered in §1).
`design-stack.md` §1 (the hosting rows), §2 (ceilings), §4 rule 5 (the vendor
freeze D1 asks to amend) and §5 (the risks this plan retires or restates).
`design-scale-and-free-tier.md` §0 ("where the app actually is" — this plan
moves it), §2.6 (idle pausing — D4), §3 (arrival order of the ceilings) and §5
(the "re-read before ARC-012" instruction, honored by §2 below).
`plan-mvp-roadmap.md` Phase 4 and Phase 9 execution notes — the second names
"a real social-preview debugger" as the first thing to re-check after this
transition. `supabase/README.md` in full: it is the document Phase 4 rewrites.

**Code.** `supabase/config.toml` (`[auth]` at :154–270, `[auth.external.google]`
at :361–370, `[api]` at :7–24 — the `auto_expose_new_tables` comment matters),
`supabase/seed.sql` :1–95 (why it must never touch prod), `apps/web/src/lib/site.ts`
(the `siteUrl()` fallback chain), `apps/web/src/proxy.ts`,
`apps/web/src/app/auth/callback/route.ts`, `apps/web/src/components/auth/auth-page.tsx`
:96–160 and :399–420, `apps/web/src/lib/supabase/server.ts` (`smokeTest()` is
the keep-alive query), `apps/web/src/components/team-gate.tsx` :64–206 (the
empty-database first run), `packages/shared/src/infra.ts` (the flag union D9
touches).

---

## 2. What the research established (verified 2026-09-07)

Seven research passes, each web-verified against vendor documentation on
2026-09-07, then every load-bearing claim independently re-checked by an
adversarial pass that tried to refute it. What survived is below; what was
refuted is corrected in place. Provenance in §9. Quotas and policies are
September-2026 snapshots — `design-scale-and-free-tier.md` §5 says when to
re-take them.

### 2.1 Email: the built-in mailer cannot reach your friends

Three independent facts, each verified against supabase.com and each fatal on
its own:

1. **Recipient restriction.** "Unless you configure a custom SMTP server for
   your project, Supabase Auth will refuse to deliver messages to addresses that
   are not part of the project's team." A friend requesting a code gets
   `Email address not authorized`. This applies on every plan, to every auth
   email type including `signInWithOtp`. (docs/guides/auth/auth-smtp)
2. **Two emails per hour, project-wide.** "You can only change this with a custom
   SMTP setup." (docs/guides/auth/rate-limits)
3. **Template lock on new free projects.** Since 2026-06-03, new free-tier
   projects on the default mailer cannot modify their auth email templates at
   all. The whole reason email login is a *code* is `templates/magic_link.html`
   rendering `{{ .Token }}` instead of a link — on the default mailer, a project
   created today cannot apply it. Custom SMTP lifts the lock.
   (changelog/46599)

With custom SMTP configured the default cap becomes 30/hour and is raisable
(`rate_limit_email_sent`), the recipient restriction disappears, and templates
are editable. **The template is not carried by `supabase config push`** —
Supabase's docs say to paste it into the Dashboard — but the Management API
(`PATCH /v1/projects/{ref}/config/auth`, field `mailer_templates_magic_link_content`)
accepts it directly, so an agent holding the owner's access token can push it
without a click. `[auth.email.smtp]` with `pass = "env(...)"`, `rate_limit`
values and `[auth.external.*]` are all part of the config-as-code surface.

Free SMTP options ranked for this use (zero cost, no domain purchase, no card,
arbitrary recipients from day one):

| Provider | Free cap | Needs a domain you own? | Card? | Verdict |
|---|---|---|---|---|
| **Brevo** | 300/day | **No** — verify one sender address by clicking a link | No | **Recommended.** `smtp-relay.brevo.com:587`, user = Brevo login email, pass = an *SMTP key*. Without an authenticated domain Brevo relays Gmail/Yahoo/Microsoft-bound mail through its own `@brevosend.com` domain, so the "From" some friends see may be Brevo's, not the owner's — cosmetic, verified by a real-inbox test in Phase 3. |
| Resend | 3,000/mo, 100/day | **Yes** — `onboarding@resend.dev` delivers only to the account owner | No | Ruled out until the owner owns a domain. Easy upgrade later. |
| Gmail SMTP + App Password | ~500/day | No | No | Works, but uses a personal mailbox as a transactional relay; stopgap only. |
| Postmark | 100/mo | No | No | Manual account approval before non-owner recipients; cap too thin. |
| Mailjet | 200/day | Sender validation | Unverified | No advantage over Brevo. |
| MailerSend | 500/mo | Trial domain only | **Yes** | Card on file — out. |
| Amazon SES | Sandbox only | Sandbox blocks unverified *recipients* | **Yes** | Out. |
| SendGrid | — | — | — | Free plan retired 2025-07-26. |

**Refuted alternative, do not build on it:** "ship Google-only for the alpha by
setting `[auth.email] enable_signup = false`". The flag's real behavior is
contested by Supabase's own CLI maintainers (it maps to the whole-provider
switch, contradicting this repo's config.toml comment and Supabase's general
docs — supabase/cli PR #4469, closed unresolved). Untested, so not a fallback.

### 2.2 Google sign-in: publish the consent screen; the scary screen is not this app's problem

- The console UI is now **Google Auth Platform** (APIs & Services → Google Auth
  Platform, or `console.cloud.google.com/auth/branding`) with four tabs:
  Branding, Audience, Data Access, Clients.
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
  Phase 0 step 9 is a ten-minute test with three fallbacks (D7). Independently of
  Google, the alpha gets a privacy page anyway (D8) — it is the honest thing to
  have on a public URL that stores emails, Google profile basics and avatars.
- Without brand verification the consent screen shows the project's
  `<ref>.supabase.co` host rather than the app name — Supabase's own docs say
  this "does not inspire trust". Acceptable friction for a friend group;
  removable later with a custom Supabase domain (paid) or brand verification.
- The callback URI is `https://<project-ref>.supabase.co/auth/v1/callback`;
  the OAuth client type must be **Web application**. The existing dev client
  registers only `http://127.0.0.1:54321/auth/v1/callback` and origin
  `http://localhost:3000`.
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
| Email templates | `content_path` is local-only; hosted takes Dashboard paste or Management API | D6. |
| Admin API | `auth.admin.createUser({ email_confirm: true })` and `auth.admin.generateLink()` send no mail and were explicitly exempted from the recipient restriction | Agents mint sessions on dev without any inbox, exactly as they do locally today. |
| Seeded accounts on hosted | `seed.sql`'s `auth.users` + `auth.identities` insert uses `extensions.crypt`, and pgcrypto is installed by default in `extensions` on hosted Postgres | `db reset` on **dev** yields the ten `@sl.local` accounts with password `slfakebets`, same as local. Dev only. Re-verify after any hosted Postgres/Auth version bump. |

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
| Git integration | `vercel link`, project settings via `vercel api … -X PATCH`, env vars via `vercel env add`, `vercel deploy --prod` and `vercel git connect` all work with a token; **installing the Vercel GitHub App on the repo is a one-time browser consent** | Phase 0 step 4. |
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
- Abuse surface on a public URL, ranked: the built-in mailer (fixed by D1) ≫
  `skip_nonce_check` (fixed by D7) ≫ everything else. Invite codes are
  31^8 ≈ 8.5×10¹¹ combinations; chat has a DB-enforced flood trigger; duels have
  a pending cap; `analytics_events` accepts anonymous inserts with an unbounded
  `properties` blob (low × low; a `pg_column_size` check is Phase 1 task 9).

---

## 3. Decisions this plan takes (owner may overrule)

- **D1 — A third vendor for email: Brevo, on explicit owner approval.** This
  amends `design-stack.md` §4 rule 5 ("vendor count frozen at 2 … adding any
  third service requires explicit owner approval") — the approval is being
  requested here, not assumed. Brevo is the only free option in §2.1 that needs
  no domain, no card, and delivers to arbitrary recipients after a single
  click-to-verify of the owner's own address. Configured **on both projects**
  (same credentials) so dev behaves like prod and the owner's own OTP tests are
  real ones. `sender_name = "SL"` (UX-021), `admin_email` = the verified
  address. `rate_limit.email_sent` raised to 60/hour in the same commit —
  per-IP limits (`sign_in_sign_ups`, `token_verifications`, 30 per 5 minutes)
  don't bind a friend group on separate networks; the project-wide email cap
  is the only shared one. Brevo's 300/day is the new ceiling to record in
  `design-scale-and-free-tier.md`.
  *If the owner refuses the third vendor*, the honest consequence is that email
  login is unavailable to friends and Google is the only door — and that path
  is itself hostage to §2.2's unverified Publish behavior. State that plainly
  rather than pretend otherwise.

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
  same Management API endpoint D6 already uses (`site_url`, `uri_allow_list`
  are fields on it), scripted per project. Either way the redirect allow-list
  carries `http://localhost:3000/**`, `http://127.0.0.1:3000/**`,
  `https://<prod-host>/**` and `https://*-<vercel-scope>.vercel.app/**`, and
  `additional_redirect_urls` becomes the union so both projects accept both
  origins (the Google JS-origin allow-list is what actually scopes OAuth per
  environment).

- **D6 — The email template is pushed by script, not by hand.** `supabase config
  push` does not carry `content_path`; `PATCH /v1/projects/{ref}/config/auth`
  with `mailer_subjects_magic_link` + `mailer_templates_magic_link_content`
  does. `scripts/supabase-push-email-templates.mjs` reads
  `supabase/templates/magic_link.html` and PATCHes the ref it is given. It
  must run **after** SMTP is configured on that project — the 2026-06-03 lock
  applies while a free project is still on the default mailer.

- **D7 — Two Google OAuth clients, published consent screen, `skip_nonce_check`
  permanently `false`.** The existing dev client keeps `http://localhost:3000`
  as its JS origin (local `next dev` against hosted dev still presents as
  localhost) and gains one redirect URI, `https://<dev-ref>.supabase.co/auth/v1/callback`.
  A new **Web application** client, "SL — production", gets
  `https://<prod-ref>.supabase.co/auth/v1/callback` and JS origin
  `https://<prod-host>`. Its secret goes into `supabase/.env` under its own
  name and is referenced by the prod `[remotes]` override. The consent screen
  is **published** (Phase 0 step 9). Three fallbacks if Publish demands a
  homepage/privacy URL on an authorized domain and rejects `vercel.app`:
  (a) publish with the Branding links blank — allowed for non-sensitive scopes
  if the UI permits it; (b) keep Google hidden behind the new `auth-google`
  flag (Phase 1 task 8) and run an email-code-only alpha until resolved;
  (c) the owner buys a domain (~US$10–20/yr) — breaks zero-cost, owner's call,
  and the only path to a trustworthy consent screen anyway. Brand
  verification is not required and not pursued now.

- **D8 — Release-like polish, and nothing beyond it.** In: a `/privacy` page
  (English; a `privacy` message namespace so it follows the locale if pt-BR is
  on), auth-screen errors routed through `MutationErrorCode` like every other
  surface, a root `error.tsx` in the house style, a build tag from
  `VERCEL_GIT_COMMIT_SHA` in the profile menu or auth-page footer (a short
  SHA is what shipped consumer apps do; it is not an alpha banner), the
  `100vh` → `100svh` nit, a friendly throw when the Supabase env vars are
  missing. Out: any in-app bug-report surface — **team chat is the alpha's
  feedback channel**, written down here so no later session proposes a widget
  against ARC-017 and the vendor freeze; a "service is paused" screen (D4
  makes it a non-event; fail-soft to signed-out is the coded behavior); an
  admin UI (Supabase Studio is the control plane, now the hosted one).

- **D9 — Flags at launch.** `duel-bets`, `global-team-chat` and
  `coming-soon-teasers` ship ON, as seeded — they gate finished, verified
  features and are kill switches, not gates. `locale-pt-br` is seeded OFF; the
  pt-BR pass is complete and browser-verified (`plan-i18n-ptbr.md` §8) and the
  friend group is Brazilian, so **the recommendation is ON in a migration**
  (`update … where key = 'locale-pt-br'`, the same shape `team_chat.sql:433`
  used) so dev and prod agree and the decision is in git. Owner confirms in
  Phase 0. The new `auth-google` flag (D7) ships ON. Everything else stays OFF.

- **D10 — Where every secret lives, by name.** Two gitignored files and the
  Vercel env store; nothing else. `supabase/.env` (already exists, consumed by
  `config.toml`'s `env()`): `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET`
  (dev client, unchanged), `SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID/SECRET`,
  `SUPABASE_AUTH_SMTP_PASS` (the Brevo SMTP key). `.env.ops` at the repo root
  (new; `.gitignore` already ignores `.env.*`, add `!.env.ops.example` for the
  committed template): `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`,
  `SUPABASE_ORG_ID`, `SUPABASE_DEV_PROJECT_REF`, `SUPABASE_PROD_PROJECT_REF`,
  `SUPABASE_DEV_DB_PASSWORD`, `SUPABASE_PROD_DB_PASSWORD`, `SUPABASE_DEV_SECRET_KEY`
  (the dev `sb_secret_…`, for admin-API session minting), `CRON_SECRET`.
  **The prod `sb_secret_…` key is not stored on disk by default**; when a task
  needs it, it is fetched with `supabase projects api-keys` for that task and
  not written down. `apps/web/.env.local` keeps exactly its two
  `NEXT_PUBLIC_*` names, now pointing at dev. The web app never sees a secret
  key, on either project — grep-enforced today, kept that way.

- **D11 — CI is a GitHub Actions workflow running typecheck, lint and test on
  every push and PR.** Vercel builds independently on push; the workflow is
  the part Vercel does not do (tests). Free on a public repo.

- **D12 — The spec moves.** `ARC-012` reads "Phase 3: hosted backend, still
  dev/staging, not production." The owner's request of 2026-09-07 defines the
  step past it — hosted, friends using it, still free-tier, still "early
  access" per ARC-001. Phase 4 updates `AGENT_SPEC.md` §4.3's ARC-012 note and
  §7 (current dev phase), and `design-stack.md` §4 rule 5 (vendor count 3 on
  the owner's D1 approval, with the date). `vision.md` is the owner's; if the
  owner wants the "hosteado mas ainda de dev" sentence to say more, that edit
  is theirs.

---

## 4. Phase 0 — Owner-only steps, in one sitting

Everything an agent cannot do because it needs a human's browser, identity, or
credit-card-free-but-still-personal account. Do them in this order; the whole
list is roughly 45 minutes plus two short waits (a Brevo verification email,
and the agent creating the projects mid-way). Hand each value to the agent by
pasting it into the named file — never into chat.

**Before starting:** confirm the browser is signed into the **`pasilvadev`**
GitHub identity (the repo's remote is the `github-pessoal` account), and into
the Google account that owns the existing Google Cloud project (the one holding
client `898339473490-…`). Both Vercel and Supabase will offer "Continue with
GitHub" — use it, with that identity. Expect each vendor to ask for email
confirmation, possibly a CAPTCHA, possibly a 2FA nudge; none needs a card.

**A. Decisions (write the answers at the top of `.env.ops` as comments, or tell
the agent):**

1. **D1** — approve Brevo as the third vendor, or refuse it and accept
   email-less login for friends.
2. **D9** — `locale-pt-br` ON for the alpha (recommended) or OFF.
3. **D2** — confirm the two Supabase project names and the Vercel project name
   (`sl-fake-bets` / `sl-fake-bets-dev` / `sl-fake-bets`), or pick others.
4. **D12** — acknowledge that this plan is the ARC-013 order for the 2→3 move
   *and* the step past ARC-012's "still dev/staging" wording.

**B. Accounts and tokens:**

5. **Supabase.** Sign up at supabase.com with GitHub. A personal organization
   is created automatically — no separate step. Then **Account → Access
   Tokens → Generate new token** (name it `sl-fake-bets agents`); paste it as
   `SUPABASE_ACCESS_TOKEN=` in `.env.ops`. Do not create projects by hand — the
   agent does that, so the refs, passwords and keys land in the right files.
   If the signup flow shows a plan chooser, pick **Free**; it should not ask
   for a card.
6. **Brevo** (if D1 approved). Sign up at brevo.com (free plan, no card).
   **Senders & IP → Senders → Add a sender**: your own email address, name
   `SL`. Click the verification link Brevo emails you. Then **SMTP & API →
   SMTP → Generate a new SMTP key**; paste it as `SUPABASE_AUTH_SMTP_PASS=` in
   `supabase/.env`, and the sender address as `SUPABASE_AUTH_SMTP_SENDER=` in
   the same file. Note the SMTP login shown on that page is your Brevo account
   email — tell the agent which address that is.
7. **Vercel.** Sign up at vercel.com with GitHub (Hobby). **Account Settings →
   Tokens → Create**: scope it to your personal account, expiry of your
   choosing (it can be revoked after Phase 3); paste as `VERCEL_TOKEN=` in
   `.env.ops`. Then **install the Vercel GitHub App on the repo**: the agent's
   first `vercel git connect` prints a github.com authorization URL — open it
   once, grant access to `pasilvadev/sl-fake-bets` only. (Alternatively:
   github.com/settings/installations → Vercel → Configure → select the repo.)
   This is the one Git-integration step that has no CLI.

**→ Hand-off point.** Tell the agent Phase 0 A–B is done. Within about ten
minutes it creates both Supabase projects and the Vercel project and reports
three values back to you: the **dev project ref**, the **prod project ref**,
and the **production hostname**. You need them for part C.

**C. Google Cloud console (Google Auth Platform):**

8. **Clients → the existing client** (`898339473490-…`): add Authorized
   redirect URI `https://<dev-ref>.supabase.co/auth/v1/callback`. Leave its JS
   origin (`http://localhost:3000`) as is. Save.
9. **Audience → Publish app.** Watch what the dialog demands:
   - If it publishes with only the app name, support email and developer
     contact filled → done. Note "Publish: no links required" for the agent.
   - If it insists on a homepage and privacy-policy URL: come back to this step
     after Phase 3 step 1 (the production URL exists then) and use
     `https://<prod-host>` and `https://<prod-host>/privacy`. If the
     "Authorized domains" field rejects the `vercel.app` hostname, tell the
     agent — D7's fallbacks apply and the choice between them is yours.
   - Do **not** submit for brand verification; not needed (§2.2).
10. **Clients → Create client → Web application**, name `SL — production`,
    Authorized JavaScript origin `https://<prod-host>`, Authorized redirect URI
    `https://<prod-ref>.supabase.co/auth/v1/callback`. Paste the client ID and
    secret as `SUPABASE_AUTH_EXTERNAL_GOOGLE_PROD_CLIENT_ID=` /
    `..._PROD_SECRET=` in `supabase/.env`. Do not download the JSON into the
    repo folder; if you do, it is gitignored (`client_secret*.json`), but the
    existing one in the repo root should be moved out of the working tree
    anyway (hygiene, not a leak — it was never committed).

**D. Optional, when convenient:**

11. A second email address you control that is **not** the Brevo sender and
    **not** a member of the Supabase org — Phase 3 uses it to prove a
    "stranger" receives the code. A friend's willingness to be the first real
    signup on their own phone does the same job better.
12. Nothing else. Every remaining step in this plan is an agent's.

**What the owner types, total:** two `.env.ops` lines, four `supabase/.env`
lines, and answers to four decisions. Everything else is clicks.

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
   grants); `[auth.rate_limit] email_sent = 60`; a commented-in
   `[auth.email.smtp]` block: `enabled = true`, `host = "smtp-relay.brevo.com"`,
   `port = 587`, `user = "env(SUPABASE_AUTH_SMTP_USER)"`,
   `pass = "env(SUPABASE_AUTH_SMTP_PASS)"`, `admin_email = "env(SUPABASE_AUTH_SMTP_SENDER)"`,
   `sender_name = "SL"`; `additional_redirect_urls` = the union in D5 with
   `<prod-host>` and `<vercel-scope>` as `env()` placeholders resolved in
   Phase 2; a `[remotes.production]` block (D5) with `project_id = "env(SUPABASE_PROD_PROJECT_REF)"`
   and nested `[remotes.production.auth] site_url = "env(NEXT_PUBLIC_SITE_URL)"`
   plus `[remotes.production.auth.external.google]` pointing at the
   `_PROD_` env names. Every `env()` name is listed in a new
   `supabase/.env.example`. **The base `site_url` stays `http://localhost:3000`**
   — that is dev's correct value.
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
5. **Auth-screen errors through the catalog** — `auth-page.tsx:103/:131/:153`
   stop rendering `error.message`. Map GoTrue error codes
   (`otp_expired`, `otp_disabled`, `over_email_send_rate_limit`,
   `email_address_not_authorized`, `validation_failed`, `signup_disabled`,
   network failure) to `MutationErrorCode` values, adding the few codes that
   are new to `packages/shared/src/errors.ts` and their sentences to both
   `messages/*.json` under `errors` (the exhaustive `Record` makes an omission
   a typecheck failure). Log the raw message with `console.error`, as D9 of
   the i18n plan does for SQL. The "Continue with Google" button renders only
   when `useFeatureFlag("auth-google")` is true (task 2).
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
   `noindex: false`, added to `sitemap.ts`. Plain language, under 400 words:
   what is stored (email or Google profile basics, display name, avatar,
   bets/wagers/chat within a team), where (Supabase, Vercel, Brevo for sending
   codes — names the processors honestly), that coins have no monetary value,
   that a team leader can remove members, how to delete an account (email the
   owner — no self-serve deletion exists and none is built here), no analytics
   beyond the two ARC-017 metrics, no ads. `privacy` namespace in both
   catalogs (pt-BR follows the flag). Linked from the auth page footer beside
   the `EN · PT` pair. **Not legal advice; the owner reads it before Phase 3.**
9. **Small hardening** — `dashboard-page.tsx:33` `100vh` → `100svh`; a new
   migration adding `check (pg_column_size(properties) <= 4096)` on
   `analytics_events` (the writer never sends more than a step name and a
   code); `apps/web/package.json` gains `"engines": { "node": "22.x" }`.
10. **Ops scripts** (D3, D6) — `scripts/db-push-prod.sh` (the guard described
    in D3, `set -euo pipefail`, sources `.env.ops`, refuses to run if the
    linked ref in `supabase/.temp/project-ref` equals the prod ref),
    `scripts/supabase-push-email-templates.mjs` (Node 22, `fetch`, PATCHes
    `mailer_subjects_magic_link` and `mailer_templates_magic_link_content` for
    the ref passed as `--project-ref`, reads the token from the environment,
    prints the response status and nothing else), `scripts/supabase-privilege-audit.sql`
    (for every table in `public`: `has_table_privilege` for `anon` and
    `authenticated` on select/insert/update/delete; for every function in
    `public` and `app`: `has_function_privilege` for both roles — the expected
    matrix is the grants in the migrations, and the query prints only rows
    that deviate). Root `package.json` scripts: `db:push:dev` → `supabase db
    push --linked`, `db:push:prod` → `bash scripts/db-push-prod.sh`,
    `db:reset:dev` → `supabase db reset --linked`, `db:status` → `supabase
    migration list --linked`, `email:templates:dev` / `:prod`.
    `.env.ops.example` with every D10 name and an empty value;
    `.gitignore` gains `!.env.ops.example`.
11. **CI** (D11) — `.github/workflows/ci.yml`: checkout, `pnpm/action-setup@v4`
    pinned to 11.25.0, `actions/setup-node@v4` with `22.19.0` and pnpm cache,
    `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
    `pnpm test`. No deploy step — Vercel's Git integration deploys.

**Exit criteria:**

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; CI green on
  the push.
- `next dev` with the two `NEXT_PUBLIC_SUPABASE_*` values blank renders the
  task-3 message, not a stack trace from `@supabase/ssr`.
- `curl -i localhost:3000/api/keepalive` → 401; with the bearer header → 200
  and `{ ok: false, … }` against a dead stack (the route itself works; the
  query result is Phase 2's job).
- The auth page, forced into each mapped error, shows a catalog sentence in
  both locales and the raw SDK text appears only in the console.
- Throwing inside a client component renders the new `error.tsx`, not Next's
  default.
- `/privacy` is server-rendered HTML with an `<h1>`, listed in
  `/sitemap.xml`, linked from the signed-out page.
- `bash scripts/db-push-prod.sh` with `.env.ops` absent exits non-zero with a
  one-line reason before touching the network.
- `supabase/.env.example` and `.env.ops.example` name every variable the
  phases below read; `grep -rn "SERVICE_ROLE\|sb_secret" apps/web` is still
  empty.

**Sizing:** ~16 files — `config.toml`, two migrations, `infra.ts`, `errors.ts`,
`en.json`, `pt-BR.json`, `env.ts`, `client.ts`/`server.ts`/`proxy.ts`,
`api/keepalive/route.ts`, `vercel.json`, `robots.ts`, `sitemap.ts`,
`auth-page.tsx`, `error.tsx`, `build-info.ts`, `next.config.ts`,
`profile-menu.tsx`, `privacy/page.tsx`, `dashboard-page.tsx`, three scripts,
two example env files, `.gitignore`, root `package.json`, `apps/web/package.json`,
`ci.yml`. Honestly counted that is nearer 30, most of them one-line edits.
**If the session runs long, split at tasks 1–4 + 10–11 / 5–9**: the first half
is what Phase 2 needs; the second half is polish Phase 3 needs.

**Risks:** GoTrue error-code names — read them from
`node_modules/@supabase/auth-js`'s `AuthError` codes, not from memory. The
`[remotes.*]` syntax — read the CLI's own `config.toml` reference for v2.116
before writing it; if the CLI rejects the block, keep the base file valid and
let Phase 2 use the D5 fallback.

### Phase 2 — Provision and wire (needs Phase 0 A–B) **[ARC-013: owner order required]**

**Goal:** both Supabase projects and the Vercel project exist, hold the full
schema and the auth configuration, send real email, and a preview deployment
of `main` runs against dev. Nothing is public yet: the production environment
is created but its `site_url` still points at a placeholder until Phase 3.

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
   `true`, 2 MiB; upload a PNG into `avatars/<any-uuid>/x.png` in Studio as
   a signed-in user later in Phase 3 (needs a session).
5. **Seed dev:** `pnpm db:reset:dev` (prompt: yes — this is dev, and the
   linked ref was just verified). Confirm `select count(*) from auth.users`
   = 10 and a password grant works:
   `curl -X POST https://<dev-ref>.supabase.co/auth/v1/token?grant_type=password
   -H "apikey: <publishable>" -d '{"email":"rafa@sl.local","password":"slfakebets"}'`
   → a session. This is the agents' cheapest session path on dev from now on.
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
   step 7), then re-run.
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
8. **Auth config to both projects** (D1, D5): with `supabase/.env` holding the
   SMTP values (Phase 0 step 6) and the Google values, `supabase config push
   --project-ref <dev-ref>` then `--project-ref <prod-ref>`. Verify in each
   project's Dashboard (Authentication → URL Configuration, → Providers →
   Google, → Emails → SMTP, → Rate Limits) that `site_url`, the allow-list,
   SMTP host/user, `skip_nonce_check = false` and `email_sent = 60` landed
   with the right per-project values. If `[remotes.production]` did not
   apply, `PATCH /v1/projects/<prod-ref>/config/auth` with `site_url`,
   `uri_allow_list`, `external_google_client_id`, `external_google_secret`
   from a small script, and record in this document which path worked.
   **Prod's Google provider gets the production client (Phase 0 step 10); if
   that step is not done yet, push without Google on prod and repeat after.**
9. **Templates** (D6): `pnpm email:templates:dev` then `:prod`. Confirm in
   Dashboard → Authentication → Emails that Magic Link shows the bilingual
   code template.
10. **The first real code:** from a local `next dev` pointed at dev, request a
    code for the owner's address; it arrives from the Brevo sender with a
    6-digit code (not a link) within a minute; entering it signs in; a fresh
    account lands on `NoTeamsScreen`. Check the raw headers: `From` is the
    verified sender or Brevo's relay domain — note which, for §2.1's
    cosmetic caveat.
11. **Realtime on hosted:** two browsers against dev (one via a seeded
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
- An OTP email reaches the owner's real inbox from Brevo with a code; sign-in
  completes; the daily reward and onboarding grant appear as they do locally.
- Realtime propagates between two devices on the hosted dev project.
- No prod secret key exists on disk (`grep -r sb_secret .env.ops supabase/.env` shows only the dev key).

**Sizing:** almost no files — `.env.ops`, `apps/web/.env.local`, `supabase/.env`
(all gitignored), possibly a fallback script for D5, plus edits to this
document recording what actually happened. Budget the session for
**waiting and verifying**, not writing: project provisioning, DNS-less
deploys and email delivery each take minutes, and the pnpm-11 build risk may
cost two or three build cycles.

**Risks:** the pnpm 11 build (mitigation order in task 7); `[remotes]` not
applying (fallback in task 8); Brevo delivering into spam on the first send
(a new sender with no domain authentication — check the spam folder before
assuming SMTP is broken); the Data API grants (the audit catches a miss before
any user does).

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
   is the production origin, not `localhost`.
3. **Google on prod** (after Phase 0 step 10): `supabase config push
   --project-ref <prod-ref>` (or the D5 fallback) with the production client;
   verify the Dashboard shows the new client ID and `skip_nonce_check` off.
4. **Cron:** confirm in the Vercel dashboard (Settings → Cron Jobs) that the
   daily job is registered; trigger it once by hand (the "Run" control) and
   see a 200 with `flagCount` ≥ 6 in the function logs — that is a real
   `feature_flags` read counted as activity.
5. **Stranger's OTP:** from a phone, on mobile data, with the Phase 0 step 11
   address (not an org member): request a code, receive it, sign in, see
   `NoTeamsScreen`. Note delivery time and the `From` shown by that mail
   client.
6. **Stranger's Google sign-in:** same phone, a Google account that is **not**
   the owner's: tap "Continue with Google". Record exactly what the consent
   screen says (app name vs `<ref>.supabase.co`, any warning). If a warning
   or a Testing-mode refusal appears, Publish did not take — go back to Phase
   0 step 9 and D7's fallbacks, and flip `auth-google` off in prod's Studio
   until it is resolved (no deploy needed).
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
    owner's message to the group can.

**Exit criteria:**

- Two genuinely different people, on two devices, one via email code and one
  via Google, are members of the same production team and see each other's
  wagers live.
- WhatsApp renders both card types from the production URL.
- The cron has run once by hand and once on schedule (check the next day).
- Prod's `auth.users` contains only real people; `select count(*) from
  public.teams` is 1; no `@sl.local` address exists there.
- `vercel env ls` shows the production/preview split exactly as D2 says.

**Sizing:** zero code unless verification finds a defect; every defect found
here goes to `agent-docs/found-bugs.md`'s owner list or is fixed in a follow-up
commit. Budget half a session for the walkthroughs and the other half for
whatever they find.

**Risks:** Google Publish (D7 fallbacks; the `auth-google` flag means the alpha
does not wait on Google); Brevo spam placement for Gmail recipients without a
domain (if it is consistent, the answer is a domain — owner's call, out of
this plan's budget); Realtime on Nano under a real group (observe during the
first evening; `design-realtime.md` §6 holds the escalation triggers).

### Phase 4 — The Docker-free loop and the documents that describe it

**Goal:** the owner's daily development needs no container, is documented in
one place, and every agent-doc that described the local-only world tells the
truth about the hosted one.

**Tasks:**

1. **`apps/web/.env.local`** points at dev (done in Phase 2); confirm `pnpm
   dev` works from a cold Mac with Docker not installed at all: sign in with
   the owner's code or a seeded password, use the app.
2. **`supabase/README.md`** — rewrite around the new shape: a "Hosted" section
   first (two projects, which is linked, the four `pnpm db:*` scripts, the
   prod guard and *why* the prompt cannot be trusted, where each secret lives
   per D10, how to get a session as an agent on dev — password grant with
   seeded accounts, or `auth.admin.createUser` with `SUPABASE_DEV_SECRET_KEY`,
   never on prod — how the owner reads prod logs (Dashboard → Logs, one-hour
   Vercel retention, so look the same day), how to flip a flag in hosted
   Studio, how to resume a paused dev project); then the existing "Running it
   locally with Docker" section demoted to an appendix headed "Only if you
   ever need the full stack offline again", with the Mailpit caveat rewritten
   ("the dev project sends real mail through Brevo; the 60/hour cap is
   project-wide"). Keep "Things that will bite you"; add the reset-prompt
   trap and the `--include-seed` trap.
3. **`design-stack.md`** — §1 hosting rows (Phase 3 reached, date), §2 add the
   Brevo 300/day ceiling, §4 rule 5 (vendor count 3, Brevo, owner approval
   date), §5 (keep-alive → Vercel cron per D4; Google OAuth bullet corrected
   per §2.2 — no "unverified app" warning for non-sensitive scopes once
   published; SMTP bullet added).
4. **`design-scale-and-free-tier.md`** — §0 "where the app actually is"
   (hosted, two free projects, since <date>), §1 table gains the email row,
   §2.6 names the Vercel cron, §3 order unchanged, §5's "before the ARC-012
   transition" item marked done with the 2026-09-07 re-verification deltas
   (template lock, Data-API exposure, publishable keys, 1-year restore).
5. **`AGENT_SPEC.md`** — §1 already lists this file; §4.3 ARC-012 gains a
   dated note that the hosted early access with friends began on <date> under
   this plan; §7 "Current dev phase" becomes vision Phase 3; the ARC-013
   sentence stays. Ask before touching any requirement's tag.
6. **`plan-mvp-roadmap.md`** — one pointer line after §8: "Hosting: see
   `plan-hosted-early-access.md`." Nothing else; that document is closed.
7. **`.vscode/` / root README** — if a root README is ever written, it starts
   with the three commands: `pnpm install`, copy `.env.example`s, `pnpm dev`.
   Not required by this plan.
8. **Retire the local artifacts that lie now:** the `client_secret_*.json` in
   the repo root moves out of the working tree (owner's file, agent asks);
   `supabase/.temp` stays gitignored; the memory note "Local stack runbook"
   gets a pointer to the README's hosted section.

**Exit criteria:**

- A fresh clone plus the two example env files filled in runs `pnpm dev`
  against dev with no Docker anywhere (ARC-002).
- Every document above states the hosted shape; `grep -rn "GitHub Actions
  cron" agent-docs` returns only historical notes that say they were
  superseded.
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
5. **Brevo:** Transactional → Statistics: delivered vs bounced vs spam
   complaints for the first week. Any spam placement pattern goes to the owner
   as the domain question.
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
2. A real code to a real non-team inbox, from Brevo, rendering `{{ .Token }}`
   as six digits (Phase 2 step 10 on dev, Phase 3 step 5 on prod).
3. Google sign-in from a friend's phone (Phase 3 step 6).
4. Realtime between two devices on Nano (Phase 2 step 11, Phase 3 step 7).
5. WhatsApp and one other unfurler render both card types (Phase 3 step 8).
6. Pause and resume on dev, timed (Phase 5 step 3).
7. The cron demonstrably hits the database (Phase 3 step 4, Phase 5 step 1).
8. The prod-push guard refuses without env, prints the target, requires
   `prod` typed (Phase 1 exit criteria, Phase 3 step 1).
9. Both `NEXT_PUBLIC_SUPABASE_*` values set in all three Vercel environments;
   a preview reads dev (Phase 3 step 10).
10. A genuinely fresh user's path on prod: auth → `NoTeamsScreen` → join by
    link → grant → dashboard (Phase 3 step 7).
11. The privilege audit prints zero deviations on both projects (Phase 2 step
    4, Phase 3 step 1).
12. `grep -rn "sb_secret\|SERVICE_ROLE" apps/web` is empty after every phase.

---

## 7. Risks

1. **Brevo deliverability without an owned domain.** Gmail may junk the first
   sends from a domainless sender relayed through `brevosend.com`. Check spam
   before declaring SMTP broken; if it is chronic, the fix is a domain (owner's
   money, ~US$10–20/yr) and DKIM in Brevo — outside this plan's zero-cost
   budget and said so up front.
2. **Google Publish requiring a domain.** Unverifiable from documentation;
   resolved by a click in Phase 0 step 9; D7's `auth-google` flag keeps the
   alpha independent of the answer.
3. **pnpm 11 on Vercel.** Outside the documented support table; loud failure;
   three mitigations in order (Phase 2 task 7). Do not downgrade the repo's
   pnpm before the first two are tried.
4. **`[remotes.*]` overrides in `config.toml`.** The CLI documents them for
   branching; whether `config push --project-ref` honors them for a plain
   second project is verified on dev first, with the Management API as the
   fallback (D5).
5. **The reset footgun.** Mitigated by D3, which is discipline encoded as a
   script, not a habit. The one behavior that would defeat it — someone
   typing `supabase link --project-ref <prod-ref>` — is why the README's first
   screen says never to.
6. **Two-project quota is the ceiling.** A third free project (a second
   friend group's isolated instance, a staging clone) means pausing or
   deleting one. Not a problem today; recorded so it is not a surprise.
7. **Vercel Hobby's non-commercial clause is a product constraint.** Donations
   are exempt; ads, affiliate links or a paid contributor are not. Any of
   those forces Pro (US$20/mo) — `design-scale-and-free-tier.md` §4.4.
8. **One-hour Vercel log retention.** A friend's "it broke last night" cannot
   be investigated from Vercel logs; Supabase's API/DB logs keep one day.
   Ask for a screenshot and the build tag (D8) instead.
9. **Realtime on Nano.** Comfortably within quota on paper (§2.3); the RLS-check
   connection pool on the smallest compute is the one thing paper cannot
   settle. Observe the first live evening.
10. **Phase discipline.** Phases 2 and 3 create things outside this repo that
    cost nothing but cannot be `git revert`ed. Phase 2 does not start until
    the owner's Phase 0 hand-off, and Phase 3 step 1 (schema to prod) is the
    first irreversible-in-spirit act — the plan says so at that step.

---

## 8. What this plan deliberately does not do

- **Buy a domain.** Recorded three times above as the thing that would improve
  Brevo deliverability, the Google consent screen and the URL friends type.
  It is the first paid item worth its price and it stays the owner's call.
- **Supabase Pro / Vercel Pro.** `design-scale-and-free-tier.md` §4 holds the
  triggers; none fires at friend-group scale.
- **A custom Supabase auth domain, PostHog, Sentry, Resend, Playwright.** Each
  is a vendor; the count is three and frozen again after D1.
- **Postgres Changes → Broadcast.** `design-realtime.md` §6's triggers govern.
- **Any feature** — donations, notifications, crowd resolution, native mobile,
  the icon set, an admin UI, a bug-report form, self-serve account deletion.
  The exclusion list in `plan-mvp-roadmap.md` §6 risk 7 stands, and the one
  new flag (`auth-google`) is an operational switch on an existing login
  method, not a feature.
- **Preview-URL OAuth testing.** Structurally impossible on Hobby (§2.4);
  stop trying.
- **Brand verification with Google.** Cosmetic; revisit with a domain.

---

## 9. Provenance

Written 2026-09-07 against `main` at `228bbbe` (clean). Method: an inline scout
of the repo (config, migrations, auth code, docs), then a seven-agent research
pass — Supabase free tier and CLI; Supabase auth email and SMTP providers;
Vercel Hobby, monorepo, cron and Git integration; Google OAuth publishing;
codebase hosting readiness (with `typecheck`, `build`, `lint` and `test`
actually run against a dead local stack); the Docker-free local loop;
product readiness for a release-like alpha — each web-verified against vendor
documentation dated 2026-09-07. Fifty-five load-bearing claims then went
through an adversarial pass instructed to refute them; seven were refuted or
materially corrected and the corrections are what this document states:
brand verification is *not* needed to avoid Google's warning screen (the
mechanism is scope-gated); the Data-API exposure change does *not* retroactively
break existing projects' existing tables (it does apply to this brand-new
project, which the migrations already handle); `--project-ref` *does* exist on
`db push`/`db reset` in CLI 2.116.0 despite the reference page; the pnpm-11
failure on Vercel is *loud*, not silent, and `ENABLE_EXPERIMENTAL_COREPACK` is
*not* a guaranteed fix; the CLI no longer *fails* on an unresolved `env()`
(it warns, and could push an empty secret — a different risk); and the
"Google-only via `enable_signup = false`" fallback is *unverified*, not clean.
A completeness critic then added the owner's access token, the DB-password
home, the GitHub-identity check, the two-client OAuth merge, the permanent
`skip_nonce_check` flip, the preview-OAuth dead end and the Google-Publish
domain question, all folded in above. Vendor URLs cited in §2 were fetched
that day; treat every number as a snapshot and re-verify per
`design-scale-and-free-tier.md` §5.

Requirement anchors: ARC-001 (free tiers, ceilings documented), ARC-002 (fresh
clone, minimal accounts — three, all the owner's), ARC-003 (maintenance first:
two projects and one script over branching, profiles or a second config
mechanism), ARC-005/UX-013 (realtime verified on the hosted tier), ARC-006/007
(email code + Google, long sessions unchanged), ARC-012/013 (this plan *is*
the gated transition and says where the order lands), ARC-016 (one new flag,
operational), ARC-017 (no third metric — the build tag is not analytics),
UX-001/003/012/017/023/024/029 (self-signup, published consent screen, deep
links, privacy page in the sitemap, cards verified against a real unfurler).

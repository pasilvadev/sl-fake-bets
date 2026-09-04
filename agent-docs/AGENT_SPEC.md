# SL Fake Bets — Agent Spec

Machine-oriented translation of `/vision.md` for AI agents executing this project. English, requirement-ID'd, priority-tagged. Humans read `vision.md`; agents read this.

## 0. Document protocol — read first

- **Source of truth:** `/vision.md` (Portuguese, owner-written). The owner writes ONLY there. On any conflict between this spec and `vision.md`, `vision.md` wins.
- **Ownership:** everything under `agent-docs/` is agent-owned. Agents create and update these files; the owner does not edit them. Agents must never edit `vision.md`.
- **Vision is a starting point, not a design limiter** (its own opening disclaimer). Requirements below are mandatory only where the vision uses mandatory language; details marked as defaults or suggestions are open to better design proposals — propose, don't silently diverge.
- **Sync protocol:** last synced 2026-09-04, `vision.md` md5 `63d5c60e848a5768c3446b12c2dba05f`. When starting product/design work, check the current md5; if it differs, diff `vision.md`, update the affected requirements here, bump this snapshot line. Requirement IDs are stable: never renumber; append new IDs; mark removed requirements `[deprecated]` instead of deleting.
- **Doc routing (Claude decides):** when the owner requests planning, design, or research, Claude — not the owner — decides whether the output goes into an existing `agent-docs/` file or a new one. Rule: one file per topic, no duplicate sources on the same subject. Check the registry in §1 first; extend an existing doc when scope overlaps; create a new doc only for a genuinely new topic, then register it in §1. New file naming: kebab-case with a type prefix — `plan-<topic>.md`, `design-<topic>.md`, `research-<topic>.md`.

## 1. Doc registry

| File | Scope |
|---|---|
| `AGENT_SPEC.md` | Full product requirements derived from vision.md (this file) |
| `design-stack.md` | APPROVED tech stack decision (Next.js 16 + Supabase + Vercel, in-house analytics/flags), free-tier ceilings, binding implementation rules |
| `design-visual-identity.md` | Visual identity system: dark-only black/white/jade tokens (oklch), typography, slash motif, component specs, banned-cliché list. Supersedes original UX-020 wording (see its §0.1) |
| `design-dashboard.md` | Dashboard information architecture: shell (top bar + ticker + Pulse Rail), bet feed, future-feature placeholder inventory, scarcity ruling for co-occurring cut-* motifs, responsive tiers, Phase-1 component map |
| `plan-mvp-roadmap.md` | Path-to-MVP roadmap: 9 one-session phases from current mock-only prototype to full [mvp] set on a 100%-local Supabase backend; local-backend transition designated at its Phase 3 (still ARC-013 owner-gated); hosted backend out of scope |

## 2. Product summary

SL Fake Bets: for-fun web platform for friend groups to bet fake platform coins on arbitrary topics. Users create/join teams, create bets with options and a close time, wager per-team fake coins under pari-mutuel odds, and see everything update in real time. Zero-cost infrastructure, lowest possible onboarding friction, English UI first, black-and-white "SL" identity.

## 3. Priority tags

- `mvp` — required for MVP (includes design constraints that apply now even if the feature ships later).
- `post-mvp` — explicitly on the vision's post-MVP feature list; first wave after MVP, behind feature flags.
- `future` — vague "later/someday" in the vision; do not build, only avoid blocking.

## 4. Requirements

### 4.1 UX & product (UX-*)

**Onboarding & auth**
- **UX-001 [mvp]** Minimize screens, fields, and decisions between first entry (signup/invite link) and dashboard. Every onboarding step must justify itself against completion rate. Onboarding ease is a top-level product pillar.
- **UX-002 [mvp]** Every customizable onboarding input (display name, avatar, name color, etc.) ships pre-filled with an auto-generated placeholder so lazy users skip through with a valid profile; users who care can customize during onboarding or later in profile settings.
- **UX-003 [mvp]** Auth = lowest-friction methods only: email login + Google OAuth. No extra providers, verification gates, or multi-step security flows before app use. Auth security hardening is explicitly deprioritized.
- **UX-004 [mvp]** Keep users signed in across visits as long as practical; no short sessions or forced re-login for security's sake. Open: exact session lifetime unspecified — only the outcome (rarely see login) is mandated.
- **UX-005 [mvp]** Team invite links must not expire (non-expiring or very long-lived). Open: manual revoke/regenerate by leader/moderator unspecified.
- **UX-006 [mvp]** UI must stay performant and usable on low-end/old devices — avoid heavy assets, animations, and patterns that degrade weak hardware. Accessibility pillar.
- **UX-029 [mvp]** The accessibility pillar also covers invite and general usability friction: joining via invite and everyday use must be as frictionless as possible, treated as an accessibility concern, not just polish.
- **UX-028 [mvp]** Structure onboarding as discrete trackable steps so the funnel (per-step drop-off) and invite→signup conversion are measurable (see ARC-017).

**Dashboard & entry**
- **UX-007 [mvp]** Dashboard shows the current team's most recent bets immediately on load; zero navigation to see what's happening.
- **UX-008 [mvp]** Bet list: open bets before closed/resolved; open bets ordered soonest-closing first.
- **UX-009 [mvp]** Multi-team users get a team selector in the top bar or sidebar (placement is a design decision, not fixed).
- **UX-010 [mvp]** Switching teams re-scopes the entire app (bets, balance, chat, context) to the new team.
- **UX-011 [mvp]** Returning authenticated users land directly on their default/first team's dashboard — never a login screen or hero page (Discord-style). Open: how "default team" is chosen for multi-team users.
- **UX-012 [mvp]** Visitors arriving via invite or bet-share link route directly into the join-team flow or bet view, never a generic landing page — with or without an existing account. Open: how the destination is preserved through signup for new users.
- **UX-013 [mvp]** New bets and wagers from other members appear in real time without manual refresh (see ARC-005).

**Modal-first navigation**
- **UX-014 [mvp]** These actions open as modals, never full-page navigations: accept team invite, act on shared bet link, edit own profile, create bet, place wager.
- **UX-015 [mvp]** One dedicated full-page view exists: bet detail (rich odds display, per-participant wagers, participant list). This is the explicitly allowed navigation.
- **UX-016 [mvp]** Wagering must always also work via modal straight from a bet card, without visiting the detail page.

**Discovery, sharing, chat**
- **UX-017 [mvp]** Public pages optimized for SEO and AI/LLM discoverability: meta tags, semantic markup, crawlable server-rendered content. Word-of-mouth + "google an app for internal bets" is the growth path. Open: which pages count as public given direct-to-app entry — presumably the logged-out landing page.
- **UX-023 [mvp]** Team invite links render a social preview (OG/Twitter card) with the team name.
- **UX-024 [mvp]** Bet share links render a social preview with bet title, current odds, and descriptive text.
- **UX-018 [mvp]** Each bet detail page has a mini chat / comments section scoped to that bet.
- **UX-019 [future]** Team-wide global chat channel (separate from per-bet threads).

**Identity, profile, platform**
- **UX-020 [mvp]** Visual identity is black/white with jade as the sole brand accent, plus the ember destructive hue and 10 curated name colors as sanctioned exceptions (see `design-visual-identity.md` §0.1, §2.2–2.4); no other decorative brand colors; traffic-light red/green/yellow banned for state.
- **UX-021 [mvp]** Brand is "SL", never spelled out as "Soulless" anywhere in the product, no explanation given. `old-soulless-bg.jpeg` (project root) is the design ancestor: never use the file directly in-app; generate new icons inspired by it; the stylized "S" glyph may be reused 1:1.
- **UX-022 [mvp]** Twitch-style profile customization: display name, name color (applied everywhere the name renders — chats and bets), platform icon set for avatar, plus custom image upload. All with defaults per UX-002.
- **UX-025 [mvp]** Fully responsive web app; good mobile-browser experience. Native mobile is far-future (empty `mobile/` folder only).
- **UX-026 [mvp]** All UI text in English at launch.
- **UX-027 [future]** pt-BR localization.

### 4.2 Domain model & mechanics (DOM-*)

**Teams, roles, invites**
- **DOM-001 [mvp]** Team creator automatically becomes leader; exactly one leader at creation. Open: leadership transfer / leader leaving unspecified.
- **DOM-002 [mvp]** At team creation the leader picks an access mode: `free-for-all` (any member creates bets and invites) or `restricted` (only moderators — and the leader per assumption A-1 — create bets and invite). Gates exactly those two actions. Open: whether the mode can change after creation.
- **DOM-003 [mvp]** Exactly two assignable roles: `moderator` and `member`. Leader is a distinct status, not a role. No custom roles. See A-1 for leader privileges.
- **DOM-004 [mvp]** Target team size ~30 members — a planning number, not stated as hard-enforced. Open: enforce in join flow or capacity assumption only?
- **DOM-005 [mvp]** Invites never expire by time (product pillar). Open: manual revocation unspecified.
- **DOM-006 [mvp]** Invite-creation permission follows the team's access mode (DOM-002).
- **DOM-035 [mvp]** No cap on how many bets a user/team can create, and no restriction on subject matter — any topic, however trivial, is valid. Core product framing.

**Bet lifecycle**
- **DOM-007 [mvp]** Bet creation requires: title (free text), options (plural — at least 2 implied), close time. Open: min/max option count unspecified.
- **DOM-008 [mvp]** Close-time input: exactly 3 preset durations with one pre-selected default, plus a custom date-time picker. Open: the 3 preset values are undecided.
- **DOM-009 [mvp]** Optional bet icon shown next to the title; MVP input is emoji only.
- **DOM-010 [future]** Platform-specific icon set replacing/augmenting emoji.
- **DOM-011 [mvp]** Only the bet creator or a moderator (leader per A-1) may close a bet early. Regular members never can.
- **DOM-012 [mvp]** Bet states, strictly ordered: `open` → `closed for bets` → `resolved`. The creation-time close time is exactly when open→closed happens automatically (or earlier per DOM-011). closed→resolved requires explicit resolver action (DOM-018/019).

**Betting mechanics**
- **DOM-013 [mvp]** Coin balance is per-team, not global.
- **DOM-014 [mvp]** No negative balance: wager input validated/capped at current team balance.
- **DOM-015 [future]** Negative balance / credit.
- **DOM-016 [mvp]** Pari-mutuel odds (Twitch channel-points style): all wagers across options form one pool; on resolution the pool is split among winning-option bettors proportional to their share of that option's total. Displayed odds reflect live pool split and update as wagers arrive. Open: house rake unmentioned — assume 100% redistributed.
- **DOM-017 [mvp]** Creator sets a per-user max bet at creation; suggested default = onboarding grant amount (DOM-021). Default is editable, not forced.

**Resolution**
- **DOM-018 [mvp]** Only the bet creator or a moderator (leader per A-1) may resolve by declaring the winning option.
- **DOM-019 [mvp]** The same resolver set (DOM-018) may instead resolve as draw/void, fully refunding every participant's wager to their team balance.
- **DOM-020 [future]** Crowd-sourced resolution: auto-resolve when N members report the same winner. Open: threshold mechanics undefined.

**Coin economy**
- **DOM-021 [mvp]** New users get an onboarding grant, reference 100 coins — tunable config, not a hardcoded magic number. Open: currency name undecided; owner explicitly welcomes suggestions.
- **DOM-022 [mvp]** Daily login reward: first login of each calendar day grants coins, reference 5 — tunable config. Open: vision frames it as helping broke users — unconditional daily grant vs only-when-depleted is ambiguous; default assumption: unconditional.
- **DOM-023 [post-mvp]** User-to-user coin donation. Explicitly on the post-MVP list. Open: limits/cooldowns undefined.
- **DOM-024 [mvp]** Leader can inject coins into any member's team balance. Vision states this as leader-only (not moderators). Open: caps/rate limits unmentioned.
- **DOM-025 [mvp]** Persist a transaction history for transfers between users (future donations) and leader injections — auditable, never lost. Distinct from wager logging.
- **DOM-026 [mvp]** No full per-wager audit trail needed. Keep a per-user aggregated profit/loss history instead. Vision softens with "maybe" — don't overbuild. Open: granularity (per-bet entries vs running total).

**Leaderboard, badges, moderation**
- **DOM-027 [mvp]** Per-team leaderboard of richest members (by current balance).
- **DOM-028 [mvp]** Per-team "podium of the poor": biggest losers by profit/loss standing. Separate from DOM-027.
- **DOM-029 [mvp]** Name badges in chats and bets: top 5, bottom 5, and distinct badges for ranks 1/2/3. Open: which leaderboard feeds which badge (assume top/ranks from DOM-027, bottom from DOM-028).
- **DOM-030 [mvp]** Chat, bet titles, and images are free-form — no content moderation/filtering system.
- **DOM-031 [mvp]** Leaders and moderators can kick or ban members. Open: functional difference kick vs ban (assume ban blocks rejoin via invite link).
- **DOM-032 [mvp]** Kick/ban removes all the user's wagers from that team's active (unresolved) bets; resolved bets stay untouched. Open: removed stake refunded, forfeited, or just removed from pool — unspecified, affects pool math.
- **DOM-033 [mvp]** Team and bet deletion is hard delete (permanent). Open: who may delete team vs bet not explicit (assume leader for team; creator/moderator for bet).
- **DOM-034 [mvp]** Hard deletes require type-to-confirm (user types the exact team/bet name), not a yes/no dialog.

### 4.3 Architecture & delivery (ARC-*)

**Stack constraints**
- **ARC-001 [mvp]** Zero monetary infra cost for prototype and early access — free tiers only; document applicable free-tier ceilings; never silently exceed them. Open: what ends "early access" is undefined.
- **ARC-002 [mvp]** Backend must run from a fresh clone with minimal steps and minimal external accounts.
- **ARC-003 [mvp]** Ease of ongoing maintenance is the SINGLE highest-priority backend criterion — above performance, features, ecosystem. Never trade maintainability for scale headroom.
- **ARC-004 [mvp]** Document the scale-up path past free tier (which tiers, what changes architecturally); don't implement it. Open: no scale targets given.
- **ARC-005 [mvp]** Realtime propagation: bet creation and wagers visible to other online team members near-instantly, no manual refresh. Open: no numeric latency SLA ("without much delay").

**Auth (implementation view — pairs with UX-003/004)**
- **ARC-006 [mvp]** Only email login + Google OAuth. Open: "email" flavor unspecified — magic link, OTP code, or email+password; pick lowest-friction available in chosen stack.
- **ARC-007 [mvp]** Long-lived sessions; returning users rarely see a login screen.
- **ARC-008 [mvp]** Do not spend effort on auth security hardening (MFA, aggressive invalidation, token rotation, brute-force protection) unless separately requested; when UX and security trade off in auth, UX wins.

**Repo & phasing**
- **ARC-009 [mvp]** Single monorepo in this folder is mandatory. The `frontend/`/`backend/`/`mobile/` split is the vision's suggestion ("can be separated"), not a mandate — adopt it unless a better layout is proposed; `mobile/` stays an empty placeholder.
- **ARC-010 [mvp]** Phase 1: frontend-only, mock/placeholder data, no DB or backend calls. Mocks must include ≥1 fake team with multiple fake bets, fake users wagering, and fake comments — product must feel near-final.
- **ARC-011 [mvp]** Phase 2: fully local backend (developer machine only, no cloud), real local persistence replacing mocks. Open: local tech unspecified.
- **ARC-012 [mvp]** Phase 3: hosted backend, still dev/staging, not production. Open: production phase undefined.
- **ARC-013 [mvp] HARD PROCESS RULE:** never advance a phase (1→2, 2→3) without the owner's explicit instruction for that specific move, in that moment. Never infer readiness from context; never batch approval in advance.

**Ops & future-proofing**
- **ARC-014 [mvp]** MVP ships with zero notifications (no push, email, or in-app alerts).
- **ARC-015 [mvp]** Design backend data models and event structures now so notifications can be added later without redesign. Build no delivery mechanism; only avoid blocking choices. Open: future channels unknown.
- **ARC-016 [mvp]** Feature flags: post-MVP features toggleable remotely without deploy or rebuild. Open: provider/approach unspecified; must satisfy ARC-001 (zero cost).
- **ARC-017 [mvp]** Observability limited to exactly two metrics: onboarding funnel (per-step completion/drop-off) and invite→signup conversion. Build nothing broader for MVP.
- **ARC-018 [mvp]** ~30 members/team as soft, tunable scale target (see DOM-004).
- **ARC-019 [mvp]** Assume few total teams / low concurrency during early access, consistent with free-tier constraint.

## 5. Assumptions (defaults until owner overrides)

- **A-1 — Leader privileges:** the vision names only "creator or moderator" for restricted-mode actions, early close, and resolution, and never states the leader inherits moderator powers. Default assumption: **leader holds all moderator permissions plus leader-only ones** (coin injection DOM-024; team deletion per DOM-033 assumption). Apply consistently everywhere. Flag to owner for confirmation.
- **A-2 — Daily reward:** unconditional +coins on first login of the day (DOM-022 ambiguity).
- **A-3 — Pari-mutuel rake:** none; 100% of pool redistributed (DOM-016).
- **A-4 — Ban vs kick:** ban additionally blocks rejoining via invite link (DOM-031).

## 6. Open decisions for the owner

Consolidated list agents should surface when relevant, not block on:
1. Fake-coin currency name (suggestions welcome — DOM-021).
2. The 3 preset bet durations and default (DOM-008).
3. Kicked user's stake: refund vs forfeit (DOM-032) — affects pool math.
4. Confirm assumption A-1 (leader ⊇ moderator permissions).
5. Team size cap: hard-enforced or soft (DOM-004/ARC-018).
6. Invite link manual revocation (UX-005/DOM-005).
7. Email auth flavor: magic link / OTP / password (ARC-006).
8. Default team choice for multi-team users on app open (UX-011).

## 7. Current dev phase

**Phase 1 (ARC-010): frontend-only with mock data.** No DB, no backend. Do not leave this phase without explicit owner instruction (ARC-013).

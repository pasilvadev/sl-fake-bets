# Design: Free-tier ceilings & the scale-up path

**Status: documentation, 2026-09-05.** Written for ARC-001 ("document applicable
free-tier ceilings; never silently exceed them") and ARC-004 ("document the
scale-up path past free tier — which tiers, what changes architecturally; don't
implement it"). Roadmap Phase 9, task 5.

**Nothing in this document is a build instruction.** ARC-004 says document, don't
implement, and every §4 item is explicitly deferred until a §5 trigger fires.
Quotas are the September-2026 values `design-stack.md` §2 and
`design-realtime.md` §2 recorded; the Realtime half of the table was re-verified
against supabase.com on 2026-09-05.

It extends `design-realtime.md` — whose §2 quota table, §3 Postgres-Changes →
Broadcast escape hatch and §6 revisit triggers are the Realtime portion of this
document, already written — to the database, storage and auth layers, and folds
in what Phases 3–8 actually shipped.

## 0. Where the app actually is

**Hosted, since 2026-09-07.** ARC-012 (Supabase Cloud + Vercel) went live that
day under its own ARC-013 order (`plan-hosted-early-access.md`): two Supabase
Cloud free projects in one org — `sl-fake-bets` (production, friends) and
`sl-fake-bets-dev` (the owner's Docker-free daily driver) — plus one Vercel
Hobby project, `sl-fake-bets`, live at `https://sl-fake-bets.vercel.app`. Every
number below is now a *ceiling a real deployment is measured against*, not a
hypothetical — which is still the point of having written them down before the
transition rather than after the first overage email. The re-verification that
transition demanded is recorded in §5.

Measured on the local stack after Phases 3–8, with the seed fixtures loaded
(3 teams, 12 accounts, 6 bets, plus the Phase-9 funnel walkthroughs):
**12 MB total database, no table above 64 kB.** That is the empty-weight of the
schema and the baseline the §2 growth estimates start from; Phase 5 of
`plan-hosted-early-access.md` ("the first week") records the hosted equivalent
here once a real week of friend traffic exists.

## 1. The ceilings

**Supabase Free** — one org, 2 active projects:

| Resource | Free | What consumes it here |
|---|---|---|
| Database | 500 MB | `bets`, `wagers`, `comments`, `transactions`, `analytics_events` |
| Egress | 5 GB / mo | Every read; `loadTeamData` dominates (§2.2) |
| File storage | 1 GB | Avatar uploads (UX-022), capped at 2 MiB each |
| Monthly active users | 50,000 | Not a real constraint at friend-group scale |
| Peak Realtime connections | 200 | One per open tab, not per user |
| Realtime messages | 2M / mo | `changes × subscribers` |
| Project pausing | after 7 idle days | The whole backend, silently |

**Vercel Hobby:** 100 GB fast data transfer, 1M edge requests, 1M function
invocations, 6,000 build minutes/month. **Personal, non-commercial use only** —
any monetization, donations included, forces Pro at $20/mo.

**Free tiers of both are non-contractual.** They have been reduced before and
will be again; this document is a snapshot, and §5 says when to re-take it.

## 2. What each ceiling actually costs at this app's shape

Scenario throughout, same as `design-realtime.md` §2: one team of 30
(`CONFIG.TEAM_TARGET_SIZE`), ~15 online at peak, ~310 row changes/day —
10 bets, 100 wagers, 200 comments.

### 2.1 Database (500 MB) — years of headroom, with one unbounded table

Rows here are small: a wager is five columns of fixed-width data, a comment is a
short string. At ~310 rows/day across every domain table, with generous
per-row overhead, five teams at this rate write on the order of **tens of MB per
year**. 500 MB is not the binding constraint, and it will not become one by
accident.

Two tables grow without a ceiling and deserve naming, and a third joins them
with an important difference:

- **`transactions`** (DOM-025) is append-only by design — `revoke update, delete`
  is in the RLS migration — and gains a row per grant, daily reward and leader
  injection. The daily reward alone is one row per member per active day: 30
  members × 365 ≈ 11K rows/team/year. Trivial as storage. **Its cost is egress,
  not disk** (§2.2).
- **`analytics_events`** (ARC-017, Phase 9) gains ~6 rows per onboarding and
  nothing at all afterwards — the funnel is instrumented, the app is not. It is
  the one append-heavy table by design and still the smallest growth vector
  here.
- **`chat_messages`** (Extra Phase 1, UX-019) writes with no natural ceiling
  either — a chatty 30-member team can send messages for as long as the team
  exists — but it is the **first of the three bounded at birth rather than
  left named-and-unfixed**. D1's 30-day hard retention window is enforced
  twice on purpose: `app.prune_chat_messages()` deletes anything older on a
  daily `pg_cron` schedule, and every read (`chat_page`) carries the same
  30-day window predicate regardless of whether the prune has run — the same
  belt-and-suspenders instinct RLS applies to access, here applied to disk.
  Rough arithmetic at this section's own scenario — call chat as busy as
  `comments` (§2's ~200/day for a 30-member team), each row three uuids plus a
  short body and a timestamp, generously ~150 bytes: steady state is
  ~200 × 30 ≈ 6,000 resident rows, under 1 MB, and that number does not move
  whether the app runs for one month or five years. Contrast that with
  `transactions` just above, which this same section names as a growth vector
  with no retention plan of its own — §4.1 fixes its *egress* cost, not its
  row count. Chat could have taken the identical named-and-unfixed shape; D1
  is the decision that it didn't.

### 2.2 Egress (5 GB/mo) — the tightest ceiling, and the one to design against

`loadTeamData` (`apps/web/src/lib/data/team-data.ts`) is **ten** unbounded
queries returning every user, team, membership, ban, invite code, bet, wager,
comment, **duel** **and the entire `transactions` ledger** the caller can see.
It runs on cold start, on identity change, and after the two mutations that
re-scope the world. (It was nine until Extra Phase 2; the tenth is `bet_duels`,
and the paragraph "**The tenth query, and why it was allowed**" below is the
argument that let it in — read it before adding an eleventh.)

That is affordable today (~1 MB raw, ~200 KB gzipped, a handful of times per
session) and it is what makes egress the ceiling to watch: the payload grows
with team history while the read frequency stays constant. `design-realtime.md`
§2 already worked the failure mode — polling that payload every 15s spends the
entire monthly 5 GB **in under two days** — which is why Phase 8's binding rule
is *apply the event payload, never refetch the world*.

**The named pre-existing weakness:** the ledger is loaded in full on every cold
start, and only the transactions modal reads it. Phase 8 recorded this
explicitly as out of its scope and left it untouched. It is the first thing to
fix if egress ever becomes real, and the fix is small — page the ledger, or load
it when the modal opens (§4.1).

**Chat is the first feature that applied this rule before shipping, not after
the fact.** Extra Phase 1 (UX-019) does not add a query here at all:
`chat_messages` loads lazily, the moment its surface (rail or modal) first
mounts, through its own paged RPC (`chat_page`, §2.1) rather than through
`team-data.ts`. The paragraph above names the fix for `transactions`'s
cold-start weakness after that weakness already existed; chat is the same rule
applied prospectively — §4.1's ceiling-to-watch reached this table before any
session had the chance to bolt an extra query onto `loadTeamData` by default.

**The tenth query, and why it was allowed** (`bet_duels`, Extra Phase 2). This
is the first table since this document was written to be added to the cold-start
batch rather than kept out of it, so the reason is recorded here rather than
left to be inferred from a diff:

- **It is bounded by the bet count it hangs off, not by a message rate.**
  `bet_duels` is 1:1 with the `bets` rows whose `kind` is `'duel'`
  (`bet_id` is both its primary key and its foreign key), so it is a strict
  subset of a payload this function already fetches in full. Chat's row count
  is a *rate* — every member, every day, for as long as the team exists, which
  is why §2.1 gave it a retention window and its own paged RPC. A duel row
  cannot appear without a bet row appearing beside it, so the tenth query can
  never outgrow the sixth. That asymmetry is the whole argument; it is not
  "one more small table" and must not be cited as precedent for one.
- **Eight narrow columns, no body text.** `bet_id`, four uuids, a boolean, an
  integer and two timestamps — under ~150 bytes a row, against a duel
  population that is a fraction of the bets. Next to the `transactions` ledger
  this same section already names as the payload's real weight, it is noise.
- **It could not have been lazy without breaking the feed.** Chat lives behind
  a surface that mounts on demand; a duel is a *bet*, and `bet-row.tsx` renders
  its versus composition, its stake line and its per-viewer CTA in the same
  feed pass as every pool bet. Deferring the duel rows would mean a first paint
  in which duels render as pool bets and then visibly change — the class of
  flicker `computeEffectiveState` exists to avoid.
- **It also costs one sequential round trip that is not a query.**
  `loadTeamData` awaits `sweep_stale_duels()` *before* the parallel batch (D8
  half (b)), deliberately not folded into it: a sweep landing mid-read would
  hand the client a bet still reading `open` beside members already refunded,
  and Phase 7's consistency guard would report that as drift. It writes rather
  than reads, so it is not one of the ten, but it is on the cold-start critical
  path and belongs in any future latency budget.

**The eleventh has to argue for itself**, and the bar is now this paragraph:
show that the table is bounded by something already loaded, that its columns
are narrow, and that a lazy load would break a first paint. Anything failing
one of the three takes chat's road (§2.1) — its own paged RPC, behind its own
surface — not this one.

### 2.3 Storage (1 GB) — a bound already enforced in the schema

The `avatars` bucket caps uploads at **2 MiB** and allows only png/jpeg/webp/gif
(`20260905120500_storage_avatars.sql`). Worst case is one 2 MiB avatar per
account: 1 GB / 2 MiB ≈ **500 accounts** before the ceiling, and real avatars are
far smaller. Objects are public-read on purpose (UX-022 renders a face next to
every name), so avatar *reads* are Storage egress, not database egress.

The one real hazard is orphans: a user replacing an avatar leaves the old object
behind unless it is overwritten in place. Worth a check before the hosted
transition — it is a cleanup, not an architecture change.

### 2.4 Auth (50K MAU) — not a constraint, ever, at this shape

A friend-group product with 30-member teams reaches 50,000 monthly actives at
roughly 1,600 full teams. Nothing else in this document survives that long.
ARC-007's long sessions (silent refresh, `src/proxy.ts` on every navigation)
reduce auth traffic rather than increase it.

### 2.5 Realtime (200 connections / 2M messages) — see `design-realtime.md` §2

Unchanged by what Phase 8 shipped, and the shipped design is the cheap one:
**~140K messages/month (7% of 2M) and ~140 MB egress (under 3% of 5 GB)**,
because every handler applies the event's own payload. Connections peak at
15–60 tabs against 200.

Phase 8's implementation adds three facts worth carrying into any scale
decision:

- Only `bets`, `wagers` and `comments` are in the publication.
  `team_members` and `transactions` are deliberately absent — one `resolve_bet`
  updates ~30 balance rows, which would be **450 messages from a single
  resolution** at 15 subscribers, more than a normal day of everything else.
  Balances are derived from the resolution event instead.
- Replica identity stays at the default (primary key), which halves the WAL
  volume of every wager and comment versus `replica identity full`.
- The one extra read is `fetchBet` — a single row, when a remote `bets` INSERT
  arrives without its options.

### 2.6 Idle pausing (7 days) — the ceiling that bites first, and it is not a quota

A free Supabase project pauses after 7 days without traffic, and a paused
project is a hard outage: no API, no auth, no realtime. For a friend-group app
with quiet weeks this is **the most likely first production incident**, and it
has nothing to do with load. **Live since 2026-09-07:** a daily **Vercel cron**
(`/api/keepalive`, `0 9 * * *`) reads `feature_flags` on prod and counts as
traffic — `design-stack.md` §5 has the mitigation's record, including why it
is a Vercel cron rather than the GitHub Actions schedule this section
originally pointed at (D4 of `plan-hosted-early-access.md`: a public repo's
Actions schedule silently disables itself after 60 idle days, the wrong
failure mode against a 7-day pause). The dev project is deliberately left
unprotected and allowed to pause between the owner's sessions; Resume from the
Dashboard, timed, is a Phase 5 drill of that same plan.

## 3. Which ceiling is hit first

In order of realistic arrival:

1. **Idle pause (7 days)** — a calendar event, not a scale event. Mitigated with
   a cron ping, one file, no architecture change.
2. **Vercel Hobby's non-commercial ToS** — a *legal* ceiling, tripped by any
   monetization, not by traffic. Forces Pro ($20/mo), architecture unchanged.
3. **Egress (5 GB)** — the first genuine scale ceiling, arriving via cold-start
   payload growth, not via realtime. §4.1 is the response.
4. **Realtime messages / connections** — only past ~10× the current scenario;
   `design-realtime.md` §6 holds the exact triggers.
5. **Database (500 MB)** — years out at this shape.
6. **Storage (1 GB)** — ~500 maxed-out avatars.
7. **MAU (50K)** — effectively unreachable.

## 4. The scale-up path (documented, deliberately not built)

Each item names its trigger, its cost, and — because ARC-003 puts maintenance
above every other backend criterion — what it costs to *maintain*, not just to
run.

### 4.1 Stop shipping the world on cold start — free, and first

**Trigger:** egress above ~2.5 GB/month (half the free ceiling), or
`transactions` past ~50K rows.
**Change:** load the ledger when the transactions modal opens instead of inside
`loadTeamData`; then page or date-bound the remaining unbounded selects.
**Why first:** it is the only item here that costs nothing, changes no vendor and
no schema, and it attacks the ceiling that arrives soonest. Everything below is a
worse trade until this is done.
**Precedent:** the rule already has one. `chat_messages` (Extra Phase 1,
UX-019) is the first table written after this document named the cold-start
payload as the ceiling to watch, and it stayed out of `loadTeamData` from the
start (§2.2) — proof this is a rule a session can follow prospectively, not
only a fix applied after egress became a real bill.

### 4.2 Supabase Pro — $25/mo

**Trigger:** any of database > 500 MB, egress > 5 GB/mo, storage > 1 GB, or peak
Realtime connections > ~150.
**Buys:** 8 GB database, 250 GB egress, 100 GB storage, 500 connections,
5M Realtime messages, daily backups, and **no idle pausing** — which retires §2.6
and the cron ping with it.
**Architecture change:** none. Same project, same schema, same migrations. This
is the entire reason `design-stack.md` picked a stack whose free and paid tiers
differ only in numbers.

### 4.3 Postgres Changes → Broadcast — the one real architectural change

**Trigger:** `design-realtime.md` §6 — sustained peak above ~150 concurrent tabs,
monthly messages above ~1.5M, or a feature that writes many rows per user action
at high frequency.
**Why:** Postgres Changes authorizes every event against every subscriber on a
single ordered thread (~3,000 msg/sec ceiling in total), so its cost scales with
*subscriber count* rather than write rate. Broadcast-from-database moves that
work into trigger functions and scales with writes instead.
**Cost:** trigger functions per table, an authorization model to re-derive, and a
rewrite of `lib/data/realtime.ts`'s handler wiring. At ~0.001% of the current
ceiling this is the definition of a premature change — hence documented, not
built.

### 4.4 Vercel Pro — $20/mo

**Trigger:** monetization of any kind (the ToS ceiling), or the Hobby transfer /
invocation limits.
**Architecture change:** none.

### 4.5 If the analytics cap is ever lifted — PostHog

**Trigger:** the owner raising ARC-017's two-metric cap. Not a scale trigger.
`design-stack.md` §6 holds the deferred evaluation; adding it would break the
frozen vendor count (§4 rule 5) and needs explicit owner approval.

### 4.6 The exit, if Supabase itself becomes the problem

Vendor concentration is an accepted trade (`design-stack.md` §5): one outage or
pricing change hits DB + auth + realtime + storage + flags + analytics at once.
The data is plain Postgres — `pg_dump`/`pg_restore` to any host, or self-host
Supabase's open-source Docker stack. What would need rewriting is the
Supabase-specific glue: RLS policies, the Realtime wiring, the auth integration.
The domain logic would not: it lives in `packages/shared` as pure functions, and
the RPCs are its SQL twins.

## 5. When to re-read this document

- ~~Before the ARC-012 hosted transition~~ — **done 2026-09-07.** The transition
  happened (§0), and `plan-hosted-early-access.md` §2 is the re-verification
  this bullet asked for — seven research passes, web-verified against vendor
  docs that day. Five deltas from what this document had assumed, worth
  carrying forward: the built-in mailer cannot reach anyone outside the
  project's own team without custom SMTP, on any plan (why early access ships
  password login instead of the OTP this repo's auth code was built for —
  `design-stack.md` §1 Auth); projects created since 2026-05-30 don't
  auto-expose `public` tables to the Data API by default (already handled —
  every table and function here is granted by name); projects created since
  2025-11-01 issue `sb_publishable_…`/`sb_secret_…` keys rather than the
  legacy `anon`/`service_role` JWT pair, though both are issued side-by-side
  and the app uses only the publishable one; a paused project restores in
  minutes for up to **1 year** after pausing, not indefinitely; and the
  mailer's recipient restriction is *per-project*, not lifted by a paid plan —
  only custom SMTP lifts it. Next re-verification per the bullets below.
- When any §3 ceiling passes 50%.
- When a feature changes the *shape* of the maths rather than its magnitude:
  live per-second odds, presence, image-heavy chat, or anything that writes many
  rows per user action.
- Annually, regardless. Free tiers move.

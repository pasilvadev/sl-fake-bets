# Design: Realtime propagation — cost & mechanism

**Status: analysis, 2026-09-05.** Written on owner request before Phase 8 starts,
to answer two questions: are Supabase Realtime subscriptions costly in money, and
are they costly in performance — compared against the obvious alternative of
refetching on a timer. Quotas and scaling claims below were re-verified against
supabase.com on 2026-09-05; they are not recalled from the Phase-1 stack pass.

Binds: this document's §5 rules are binding for Phase 8 the same way
`design-stack.md` §4 is. It does not change the stack, the vendor count, or
ARC-005's requirement — it decides *how* that requirement is met.

## 1. Verdict

Realtime is free for this app by two orders of magnitude, and polling is the
option that actually breaks the free tier. But the margin is not a property of
Realtime — it is a property of **sending small payloads**. The expensive object
in this codebase is `loadTeamData` (`apps/web/src/lib/data/team-data.ts`), which
issues nine unbounded queries and returns every user, team, membership, ban,
invite code, bet, wager, comment and the entire `transactions` ledger the caller
can see. Any design that pulls that on a schedule — a poll, or a subscription
whose handler just calls `reload()` — costs the same and fails the same.

So the choice is not "Realtime vs polling". It is "incremental payloads vs
whole-world refetches", and Realtime is the only one of the two mechanisms that
makes the cheap option natural.

## 2. Money

Free tier, verified 2026-09-05 (Pro shown for the scale-up path, ARC-004):

| | Free | Pro |
|---|---|---|
| Peak concurrent Realtime connections | 200 | 500, then $10 / 1000 |
| Realtime messages / month | 2M | 5M, then $2.50 / M |
| Egress | 5 GB | 250 GB |
| Database | 500 MB | 8 GB |

A billed *message* is one delivery to one client, so the driver is
`changes × subscribers`, not `changes`. Connections are one WebSocket per open
tab, not per user.

Scenario used throughout: one team of 30 (TEAM_TARGET_SIZE), ~15 online at peak,
~310 row changes/day — 10 bets, 100 wagers, 200 comments.

- **Realtime, payloads applied locally:** 310 × 15 ≈ 4.6K messages/day ≈
  **140K/month, 7% of the free 2M.** Payloads are single rows (~1 KB), so egress
  is **~140 MB/month, under 3%**. Connections peak at 15–60 tabs against a
  ceiling of 200. Ten times the activity across five teams still fits.
- **Polling `loadTeamData` every 15s:** the world is ~1 MB raw, call it ~200 KB
  gzipped once the ledger holds a few thousand rows. 15 clients × 240 polls/hour
  × 4 active hours ≈ 14,400 fetches/day × 200 KB ≈ **2.9 GB/day** — the entire
  5 GB monthly egress in **under two days**, paid whether or not anything
  changed. A 60s interval is still ~22 GB/month. It fails.
- **Realtime used only as an invalidation signal** (event arrives → refetch the
  world) is the trap in the middle: ~310 refetches/day/client × 15 × 200 KB ≈
  620 MB/day ≈ 18 GB/month. Also fails. Rejected in §5.

Neither option touches Vercel's quotas: `supabase-js` runs in the browser and
talks to Supabase directly, so no Next.js function invocation is involved.

## 3. Performance, and why Postgres Changes is still the right pick

Supabase's own docs now prefer Broadcast over Postgres Changes — "the recommended
method for scalability and security", because Postgres Changes:

- **authorizes every event against each subscriber** — one row change with 100
  subscribers means 100 RLS evaluations, so cost scales with subscriber count
  rather than write rate; and
- is **processed on a single thread** to preserve ordering, so a larger instance
  buys nothing. The ceiling is roughly 3,000 messages/sec in total.

At 15–60 subscribers and ~300 changes/day this app uses on the order of 0.001%
of that ceiling. **Postgres Changes is correct for Phase 8**: it is GA
(`design-stack.md` §4 rule 2), it needs no trigger functions, and its one real
weakness is a scale this product will not reach. Broadcast-from-database is the
documented escape hatch, not current work — it belongs in Phase 9's ARC-004
scale-up document as the thing to switch to, alongside the connection and
message ceilings.

Client-side, a subscription is one idle WebSocket per tab. A poll is a timer that
re-parses and re-maps ~1 MB of JSON through `team-data.ts` whether or not
anything moved — which is also a UX cost, not just a bill.

**Owner decision D3 (Extra Phase 1, 2026-09-06) reaffirms this pick rather than
revisiting it.** Team chat's transport stays Postgres Changes, the mechanism
this section already argues for — it is one more binding on the existing
per-team channel (§5 rule 1), not a reason to open a second one. Broadcast
(`design-scale-and-free-tier.md` §4.3) remains the documented, unbuilt escape
hatch: chat does not trigger it at this app's volume, and running a second
realtime mechanism alongside Postgres Changes for one feature is a maintenance
cost ARC-003 ranks above whatever throughput it would buy.

## 4. Three setup facts Phase 8 must not discover late

1. **Nothing is in the publication.** `supabase/config.toml` enables the Realtime
   service, but no migration has ever run
   `alter publication supabase_realtime add table ...`. Until one does, Postgres
   Changes is silently inert — subscriptions connect and never fire.
2. **`replica identity full`** is required on any table whose UPDATE old-values
   or DELETE payloads matter. By default DELETE/UPDATE events carry only the new
   record.
3. **RLS is not applied to DELETE events at all** — Postgres cannot verify access
   to a row that no longer exists. `delete_bet` exists (`bet-mutations.ts`), so a
   bet deletion is broadcast to every subscriber of the channel regardless of
   team. This is a real leak surface, and the mitigation is behavioural: ignore
   any id the client does not already hold.

## 5. Binding rules for Phase 8

1. **Coarse channels only** — per team, per bet page. Never per row or per field.
   (Restates `design-stack.md` §4 rule 1; unchanged.)
2. **Apply the event's payload; do not refetch the world.** A subscription
   handler must never call the equivalent of `reload()` as its normal path.
   §2 shows why: signal-only Realtime costs more than the polling it replaced.
   A full reload stays legal as a recovery path — on resubscribe after a dropped
   connection, or on a payload the client cannot reconcile — not as the design.
3. **Subscribe to `bets`, `wagers`, `comments`, `chat_messages` and
   `bet_duels`. Do not subscribe to `team_members` or `transactions`.** One
   `resolve_bet` updates
   ~30 balance rows at once: 30 changes × 15 subscribers = **450 messages from a
   single resolution**, more than a normal day of everything else. Balances
   propagate by deriving them from the bet's resolution event, or by one scoped
   refetch triggered by it. This is also where the double-apply race recorded in
   Phase 7's notes actually bites — `resolve_bet` and `delete_bet` already return
   their deltas and the acting client already dispatches them, so replaying
   `team_members` UPDATEs would apply the same move twice.
   **`chat_messages` (Extra Phase 1, UX-019) binds INSERT only — never
   DELETE.** `app.prune_chat_messages()` enforces the 30-day retention window
   (D1) with a bulk daily delete, and a DELETE binding on this table would
   broadcast that prune to every subscriber as a burst of dead ids the client
   has no use for: the same waste rule 2 already forbids for a whole-world
   reload, here scoped to one table's one event type instead.

   **`bet_duels` (Extra Phase 2) is the team channel's fifth binding, and the
   first unfiltered one to be added deliberately rather than inherited.** It
   binds **INSERT and UPDATE**, on the *existing* `subscribeTeamChannel` — rule
   1, not a channel of its own. Four facts about it, each of which someone will
   otherwise try to "fix":

   - **It carries no `team_id`, so it cannot be filtered server-side.** A duel
     reaches its team through its bet (`bet_id` is simultaneously the primary
     key and the foreign key), the way `comments` does and unlike
     `chat_messages`, which denormalizes a `team_id` precisely so its INSERT
     binding *can* be filtered. Adding `filter: "team_id=eq.<id>"` here would
     match nothing and the binding would go **silently** inert — §4 fact 1's
     class of failure, arriving through a different door. The `wagers` binding
     above has had exactly this shape since Phase 8 and is the precedent.
   - **RLS is what scopes it, and the receiver still checks.** The row reaches
     only clients whose `app.is_bet_team_member(bet_id)` passes, and the
     handler then ignores any duel whose *bet* this client does not already
     hold — the same "ignore any id the client does not already hold" rule §4
     fact 3 makes mandatory for DELETEs, applied here as ordinary hygiene.
   - **Two events, one `RemoteEvent` variant (`duel-upsert`).** A `bet_duels`
     payload is complete on both INSERT and UPDATE, the receiver's rule is
     identical for both, and the only UPDATE a duel ever takes is `accepted_at`
     going non-null. Both are needed: INSERT is the challenge appearing, UPDATE
     is the acceptance — and without the second, a client would hold a bet that
     has flipped to `closed` (via the paired `bets` UPDATE) beside a duel row
     still reading unaccepted, which every surface would render as pending.
   - **No DELETE binding.** A `bet_duels` row only ever dies *with* its bet, by
     `on delete cascade`, and the `bets` DELETE binding already carries that id.
     Note this is delete-the-row, not void-the-duel: decline, expiry and the
     departure cascade all *resolve* the bet and leave both rows in place, so
     they arrive as a `bets` UPDATE, which rule 2 says to apply rather than
     refetch behind.

   **Extra Phase 3 (the duel surfaces) adds NO binding, and that is the entry.**
   The set above is already complete and already correct; recording the
   non-change is worth a paragraph because the phase's task list says to update
   this section and the obvious way to do that is to add a line describing
   something that does not exist. Everything the duel screens need rides the
   bindings Extra Phase 2 registered: the challenge arriving is `bets` INSERT +
   `bet_duels` INSERT, the acceptance is `bets` UPDATE + `bet_duels` UPDATE,
   and every void — declined, expired, cascaded, or a mediator's — is a `bets`
   UPDATE, because a void RESOLVES the bet rather than deleting anything.
   Verified across three browsers before this phase shipped: a challenge
   reaches the challengee's open dashboard and an acceptance reaches the
   mediator's, both without a reload.

   Two things the surfaces deliberately do NOT do with these events. **Nothing
   re-sorts or re-pins from a handler** — the feed derives "awaiting you" from
   the data it holds plus the clock on every render, so an event that changes a
   duel changes the pin as a consequence of rule 2's apply-the-payload, not
   through a second ordering channel. And **no toast is ever raised from one**:
   `toast-context.tsx`'s D5 forbids `show` outside the synchronous handler of
   an action the person took, and a duel is the most tempting thing in this
   product to announce on arrival. The pin IS the arrival notice (ARC-014).
4. **`transactions` is a growth vector independent of Phase 8.** It is loaded in
   full on every cold start and grows without bound, and it is only needed by the
   ledger view. Not Phase 8's job to fix; Phase 8 must not make it worse by
   subscribing to it.

## 6. What would change the verdict

Revisit this document if any of these becomes true — each moves the app toward
Broadcast, or toward paying:

- Sustained peak above ~150 concurrent tabs (75% of the free connection ceiling).
- Monthly messages above ~1.5M, i.e. roughly 10× the §2 scenario.
- A feature that writes many rows per user action at high frequency (live
  per-second odds, presence-heavy chat), which changes the shape of §3's maths
  rather than just its magnitude.

**Team chat (Extra Phase 1, UX-019) does not trip that last bullet.** "Presence-
heavy chat" names a specific shape — per-second presence pings, typing
indicators, a write on every keystroke — and the shipped feature has none of
it: one row per sent message, one INSERT binding added to the existing channel
(§5 rule 3), no presence, no typing state. Worth a sentence precisely because a
future reader will hit the word "chat" in this codebase and wonder whether this
document was invalidated by it; it wasn't. Revisit this document if chat itself
later grows presence or per-second writes, not because chat exists.

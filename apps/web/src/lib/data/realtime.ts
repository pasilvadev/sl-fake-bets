import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessageRow } from "./chat";
import type { BetRow, CommentRow, DuelRow, MemberRow, WagerRow } from "./team-data";

/**
 * Postgres Changes subscriptions — roadmap Phase 8 (ARC-005 / UX-013 / UX-018),
 * extended by Extra Phase 1 (UX-019, team chat) with a fourth binding on the
 * same channel — see `subscribeTeamChannel` below for why chat did not earn a
 * channel of its own — by Extra Phase 2 (1v1 duels) with a fifth and a sixth,
 * `bet_duels` INSERT and UPDATE, on that same channel and for the same §5 rule
 * 1 reason — by a post-launch bug fix with a seventh, `team_members` INSERT,
 * amending §5 rule 3's blanket "do not subscribe to team_members" — and by a
 * second post-launch bug fix (the negative-balance drift, `found-bugs.md`)
 * with an eighth, `team_members` UPDATE, which retires rule 3 entirely: see
 * `subscribeTeamChannel`'s own comment on that binding for why balances are
 * now server-authoritative on every client instead of derived from deltas.
 *
 * This module owns the wire: which channels exist, which tables and events each
 * one listens to, and how a raw payload becomes one `RemoteEvent`. It decides
 * nothing about state — team-context.tsx applies these events to the reducer,
 * because that is where the copy of the world lives and where the "do I already
 * hold this row?" question can be answered.
 *
 * The two binding rules from `agent-docs/design-realtime.md` §5 that shape this
 * file:
 *
 *   1. Coarse channels only — ONE per team (the feed) and ONE per open bet page
 *      (its thread). Never per row, never per field. Chat rides the team
 *      channel under this rule rather than opening `chat:${teamId}`: the rail
 *      is mounted on every dashboard render anyway, so a dedicated channel
 *      would double the connection count for a surface `team:${teamId}`
 *      already reaches.
 *   2. Events carry their own payload and are applied as-is. A handler that
 *      answered every event with a full `loadTeamData` would cost ~18 GB/month
 *      against a 5 GB ceiling — worse than the polling Realtime replaced. A
 *      full reload survives only as RECOVERY, which is what `onResubscribe`
 *      below exists to signal.
 *
 * Postgres Changes rather than Broadcast, deliberately: Broadcast is Supabase's
 * scale recommendation because Postgres Changes runs every event through RLS on
 * one ordered thread (~3,000 msg/sec), and this app uses ~0.001% of that. The
 * escape hatch belongs in Phase 9's scale-up doc, not in trigger functions
 * written now for a problem this product will not reach. Chat does not change
 * that arithmetic (owner decision D3): it stays on Postgres Changes rather than
 * adopting Broadcast for itself, because a second realtime mechanism used by
 * one feature is a maintenance cost ARC-003 ranks above throughput.
 */

type Client = SupabaseClient;

/** A bets row as Realtime delivers it: the bet's own columns, no options embed. */
export type RealtimeBetRow = Omit<BetRow, "bet_options">;

/**
 * What the client is told happened, already narrowed to the nine cases that
 * can change what is on screen.
 *
 * `bet-insert` carries only the id: a `bets` INSERT arrives without
 * `bet_options`, and a bet with no options cannot be rendered, so the id is
 * followed by one scoped single-row fetch (`fetchBet`).
 *
 * `duel-upsert` is ONE variant for two events, INSERT and UPDATE, which is the
 * only place in this union where that collapse is right. A `bet_duels` row is
 * a complete `DuelRow` in both payloads (no embed, no ordering column, nothing
 * to go and fetch), and the receiver's rule is identical either way: replace
 * the duel with this bet id, or ignore it if this client does not hold the
 * bet. Splitting it into `duel-insert` and `duel-update` would hand
 * team-context.tsx two reducer cases with the same body and invite them to
 * drift apart. The only UPDATE a duel row ever takes is `accepted_at` moving
 * from null to a timestamp (`accept_duel`), which is exactly an upsert of the
 * whole row.
 *
 * `member-insert` (bug fix, amending design-realtime.md §5 rule 3 — see
 * `subscribeTeamChannel`'s own comment on the binding for the full argument)
 * is a complete `MemberRow` in the same sense `duel-upsert`'s row is: no embed,
 * nothing to go and fetch for the MEMBERSHIP half of the event. What often
 * does need a fetch is the JOINER, if this client has never seen their `users`
 * row before — that second, conditional lookup is `fetchUser`, resolved by
 * team-context.tsx before it dispatches, exactly the way `bet-insert` resolves
 * `fetchBet` first.
 *
 * `member-update` (second bug fix, retiring §5 rule 3 rather than amending it
 * — see `subscribeTeamChannel`'s own comment on the binding) is also a
 * complete `MemberRow`: `coin_balance`, `profit_loss` and `role`, applied
 * ABSOLUTELY by team-context.tsx's reducer rather than added to a locally
 * tracked delta. This is what makes balances server-authoritative on every
 * open tab, not just the one that made the change.
 *
 * Deletes of `wagers`, `comments`, `chat_messages`, `bet_duels` and
 * `team_members` are absent on purpose — see `subscribeTeamChannel`.
 */
export type RemoteEvent =
  | { kind: "bet-insert"; betId: string }
  | { kind: "bet-update"; row: RealtimeBetRow }
  | { kind: "bet-delete"; betId: string }
  | { kind: "wager-insert"; row: WagerRow }
  | { kind: "comment-insert"; row: CommentRow }
  | { kind: "chat-insert"; row: ChatMessageRow }
  | { kind: "duel-upsert"; row: DuelRow }
  | { kind: "member-insert"; row: MemberRow }
  | { kind: "member-update"; row: MemberRow };

export interface ChannelHandlers {
  onEvent: (event: RemoteEvent) => void;
  /**
   * The connection came back after dropping. Events that happened while it was
   * down were never delivered and never will be, so this is the one place a
   * full reload is the right answer (§5 rule 2's recovery path).
   */
  onResubscribe: () => void;
}

/**
 * Wire `.subscribe()`'s status callback to `onResubscribe`, firing only on a
 * RE-subscribe. The first SUBSCRIBED follows a load that already fetched
 * everything; a later one follows a gap.
 */
function withRecovery(channel: RealtimeChannel, onResubscribe: () => void) {
  let everSubscribed = false;
  let missedEvents = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      if (everSubscribed && missedEvents) {
        missedEvents = false;
        onResubscribe();
      }
      everSubscribed = true;
      return;
    }
    // CHANNEL_ERROR / TIMED_OUT / CLOSED: from here on, anything that changes
    // in Postgres is invisible to this client until it is subscribed again.
    if (everSubscribed) missedEvents = true;
  });
  return channel;
}

/**
 * The team channel: everything the dashboard renders live.
 *
 * `bets` INSERT/UPDATE are filtered server-side to this team. `bets` DELETE is
 * deliberately NOT filtered: RLS is not applied to DELETE events at all — a
 * deleted row cannot be checked against a policy — and with the default replica
 * identity the payload is just the primary key, so a `team_id` filter would
 * match nothing and the event would never arrive. The event therefore reaches
 * every subscriber of every team, carrying one bet id, and the mitigation is
 * behavioural: the receiver ignores any id it does not already hold
 * (design-realtime.md §4.3).
 *
 * `wagers` INSERT carries no team column to filter on, so RLS does the scoping:
 * a subscriber only receives wagers on bets it may read. The receiver still
 * checks that it holds the wager's bet, which also drops wagers on other teams'
 * bets that this client has loaded through no team of the current dashboard.
 *
 * Wager DELETEs are not handled at all, for a reason worth recording: the only
 * two things that delete wagers are `delete_bet` — where the money is unwound
 * from the bets DELETE event, which needs those wagers still present to compute
 * the reversal, and cascade children replicate BEFORE their parent — and the
 * kick/ban cascade, whose companion `team_members` DELETE is still not
 * subscribed (§5 rule 3 still holds for that direction — see the
 * `team_members` INSERT paragraph below for the direction it no longer holds
 * for). Applying half of either one would be worse than applying neither; the
 * pool corrects on the next load.
 *
 * `bet_duels` INSERT and UPDATE (Extra Phase 2, D1/D2) are in exactly the
 * position `wagers` INSERT is one paragraph up, and for exactly its reason:
 * the table HAS NO TEAM COLUMN, so there is no server-side filter to write.
 * A duel belongs to a team only through its bet, and RLS knows that —
 * `bet_duels_select_bet_team_member` scopes reads through
 * `app.is_bet_team_member(bet_id)` — so a subscriber receives duel rows for
 * bets it may read and no others. Do not "fix" this by adding
 * `filter: "team_id=eq.<id>"`: there is no such column, the filter
 * would match nothing, and the binding would go SILENTLY inert rather than
 * erroring (design-realtime.md §4 fact 1 says the same about a table missing
 * from the publication, and this is the same class of quiet failure). As with
 * `wagers`, the receiver still checks that it holds the duel's bet, which
 * drops duels on bets this client happens to have loaded for a team other
 * than the one this channel belongs to.
 *
 * Two events rather than one because a duel changes twice on other people's
 * screens: it is CREATED (the challengee needs to see the challenge without
 * reloading — D4 re-orders the feed for them, and it can only re-order a duel
 * the client actually holds), and it is ACCEPTED (`accepted_at` stops being
 * null, which flips the row out of "waiting to be accepted" for everyone
 * watching). The accompanying `bets` UPDATE — `state='closed'`, `closes_at=
 * now()` — arrives on the `bets` binding above in the same transaction, so a
 * client that dropped one of the two would render a half-accepted duel until
 * its next load; both bindings existing is what keeps that pair whole.
 *
 * `bet_duels` DELETE is bound nowhere, and here the reason is structural
 * rather than a judgement call like the `wagers` and `chat_messages` ones
 * above: `bet_duels.bet_id references bets on delete cascade` is the ONLY way
 * one of these rows ever dies, so every duel delete is a bet delete, and
 * `bet-delete` already carries it. A duel-delete binding could therefore only
 * ever say a second time what the client is already being told, and would say
 * it with the same unfilterable, RLS-exempt DELETE payload (§4.3) that made
 * the `bets` DELETE binding need a behavioural mitigation in the first place.
 * Note that this is delete-the-ROW, not void-the-duel: a declined, expired or
 * cascade-voided duel keeps its row and reaches this client as a `bets` UPDATE
 * carrying `resolution_kind='void'` and its `void_reason`.
 *
 * `chat_messages` INSERT (Extra Phase 1, UX-019) rides this same channel — no
 * `chat:${teamId}` channel exists, and should not: §5 rule 1 is one coarse
 * channel per team, and the rail this event feeds is mounted on every
 * dashboard render, so a second channel would double the connection count for
 * a surface `team:${teamId}` already reaches. Unlike `wagers`, `chat_messages`
 * HAS a team column, so this binding is filtered server-side to
 * `team_id=eq.${teamId}` the same way `bets` is, rather than leaning on RLS
 * alone.
 *
 * `chat_messages` DELETE is bound nowhere, deliberately, and for a reason
 * distinct from the `wagers` one above: the only rows that are ever deleted
 * are the daily retention prune (D1, `app.prune_chat_messages()`) and a
 * member deleting their own message, and DOM-030 guarantees no one else's
 * message is ever removed on this client's behalf. A DELETE binding would
 * hand every subscriber the prune's nightly burst of dead ids for zero screen
 * effect: the 30-day window is enforced on the *read* path (`chat.ts`'s page
 * query), so an aged-out row simply stops being fetched — nothing needs to be
 * told to take it off screen.
 *
 * `team_members` INSERT is a post-launch bug fix, and it amends §5 rule 3
 * rather than following it: without this binding, a member joining — by
 * invite code, while an existing member's dashboard is open — was invisible
 * to everyone else at that table until they refreshed, and if the joiner was
 * a BRAND-NEW account (this client had never loaded their `users` row through
 * any team), any bet or wager they placed in the meantime rendered with no
 * name where its creator belongs, because `userById` had nothing to find.
 * Both symptoms were the same missing fact: nobody told this client a new row
 * existed in `team_members` at all.
 *
 * At the time this INSERT exception was written, the rule's actual concern —
 * the flood a `resolve_bet` UPDATE would cause (~30 balance rows × 15
 * subscribers = 450 messages from one resolution, more traffic than a normal
 * day of everything else combined) — was left untouched, because it is
 * specifically about UPDATE and this binding was INSERT-only, exactly the
 * restraint already established for `chat_messages` above (bound for INSERT,
 * never for the nightly prune's DELETE storm). A join is a single row, born
 * once per member for the life of their membership, so there was no bulk
 * write path here to flood anything — the asymmetry that made an INSERT
 * exception safe where a UPDATE one was not, yet. `team_members` HAS a team
 * column, so — like `bets` and `chat_messages`, and unlike `wagers` and
 * `bet_duels` — this binding is filtered server-side to `team_id=eq.${teamId}`
 * rather than leaning on RLS alone.
 *
 * `team_members` UPDATE is a SECOND post-launch bug fix (`agent-docs/
 * found-bugs.md`, "Negative balances on teammates' dashboards"), and this one
 * does not amend rule 3 — it retires the reasoning behind it. The 450-message
 * count above was never wrong, but it was only half the argument for staying
 * unsubscribed; the other half was that every client already derives a
 * remote balance move from the bet's own resolution/deletion event, applying
 * it as a DELTA on top of whatever it currently shows — and that is exactly
 * what broke: `member-insert` above lands a joiner at whatever `coin_balance`
 * their `team_members` row held at INSERT time (0, before `app.seed_membership`'s
 * follow-up grant lands), and grants/daily rewards/injections move balances
 * through `app.apply_transaction`, which no observer's tab is subscribed to at
 * all. Every one of those is a credit this binding never told anyone about, so
 * an observer's copy of a teammate's balance silently fell behind by exactly
 * the credits it missed, and a later delta (a wager, a payout) then applied on
 * top of that stale number — the negative balances the bug report describes.
 *
 * The fix is not "subscribe and accept the 450 messages" — the message count
 * is real and the egress budget in `design-scale-and-free-tier.md` §2.5 is
 * still worth respecting — it is that DELTAS were the wrong client-side model
 * once more than one write path could move a balance without telling every
 * open tab. So every local balance delta is gone (see team-context.tsx's
 * `member-update` reducer case and the mutators that used to call
 * `applyDeltas`): a `team_members` row's `coin_balance`, `profit_loss` and
 * `role` are now applied ABSOLUTELY, from this UPDATE, on every client
 * including the one that caused the change. 450 messages from one resolution
 * is still real traffic, but it is 450 messages carrying the TRUTH rather than
 * 450 messages this design used to refuse specifically because the client had
 * a cheaper way to reach a wrong answer. `agent-docs/design-scale-and-free-tier.md`
 * §2.5 has the updated budget arithmetic. Filtered server-side exactly like
 * the INSERT binding above, for the same reason: the column is there to use.
 */
export function subscribeTeamChannel(
  supabase: Client,
  teamId: string,
  handlers: ChannelHandlers,
): RealtimeChannel {
  const channel = supabase
    .channel(`team:${teamId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "bets",
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        const row = payload.new as RealtimeBetRow;
        if (row?.id) handlers.onEvent({ kind: "bet-insert", betId: row.id });
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "bets",
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        const row = payload.new as RealtimeBetRow;
        if (row?.id) handlers.onEvent({ kind: "bet-update", row });
      },
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "bets" },
      (payload) => {
        const id = (payload.old as { id?: string } | null)?.id;
        if (id) handlers.onEvent({ kind: "bet-delete", betId: id });
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "wagers" },
      (payload) => {
        const row = payload.new as WagerRow;
        if (row?.id) handlers.onEvent({ kind: "wager-insert", row });
      },
    )
    // Unfiltered — `bet_duels` has no team column; RLS scopes it. See the
    // header above before adding a `filter` here.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bet_duels" },
      (payload) => {
        const row = payload.new as DuelRow;
        // Guarded on `bet_id`, not `id`: this table's primary key IS its bet
        // id (1:1 with `bets`, D1), so there is no separate `id` column to
        // test and a copy-pasted `row?.id` here would be permanently falsy and
        // drop every duel event on the floor.
        if (row?.bet_id) handlers.onEvent({ kind: "duel-upsert", row });
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "bet_duels" },
      (payload) => {
        const row = payload.new as DuelRow;
        if (row?.bet_id) handlers.onEvent({ kind: "duel-upsert", row });
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        const row = payload.new as ChatMessageRow;
        if (row?.id) handlers.onEvent({ kind: "chat-insert", row });
      },
    )
    // INSERT — see the header's `team_members` paragraph for why this amends
    // §5 rule 3 safely (a join is one row, never a bulk write).
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "team_members",
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        const row = payload.new as MemberRow;
        if (row?.user_id) handlers.onEvent({ kind: "member-insert", row });
      },
    )
    // UPDATE — the negative-balance drift fix. See the header's second
    // `team_members` paragraph: balances are now server-authoritative on
    // every client, applied absolutely from this payload, never as a delta.
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "team_members",
        filter: `team_id=eq.${teamId}`,
      },
      (payload) => {
        const row = payload.new as MemberRow;
        if (row?.user_id) handlers.onEvent({ kind: "member-update", row });
      },
    );

  return withRecovery(channel, handlers.onResubscribe);
}

/**
 * The bet-page channel: one open bet's comment thread (UX-018).
 *
 * Comments are the only thing here because they are the only thing the detail
 * page shows that the team channel does not already carry — bets and wagers
 * arrive there, and the detail page reads the same store. Filtering on
 * `bet_id` keeps a busy team's other threads off this socket entirely.
 */
export function subscribeBetChannel(
  supabase: Client,
  betId: string,
  handlers: ChannelHandlers,
): RealtimeChannel {
  const channel = supabase.channel(`bet:${betId}`).on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "comments",
      filter: `bet_id=eq.${betId}`,
    },
    (payload) => {
      const row = payload.new as CommentRow;
      if (row?.id) handlers.onEvent({ kind: "comment-insert", row });
    },
  );

  return withRecovery(channel, handlers.onResubscribe);
}

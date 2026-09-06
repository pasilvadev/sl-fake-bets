import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessageRow } from "./chat";
import type { BetRow, CommentRow, WagerRow } from "./team-data";

/**
 * Postgres Changes subscriptions — roadmap Phase 8 (ARC-005 / UX-013 / UX-018),
 * extended by Extra Phase 1 (UX-019, team chat) with a fourth binding on the
 * same channel — see `subscribeTeamChannel` below for why chat did not earn a
 * channel of its own.
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
 * What the client is told happened, already narrowed to the six cases that can
 * change what is on screen.
 *
 * `bet-insert` carries only the id: a `bets` INSERT arrives without
 * `bet_options`, and a bet with no options cannot be rendered, so the id is
 * followed by one scoped single-row fetch (`fetchBet`).
 *
 * Deletes of `wagers`, `comments` and `chat_messages` are absent on purpose —
 * see `subscribeTeamChannel`.
 */
export type RemoteEvent =
  | { kind: "bet-insert"; betId: string }
  | { kind: "bet-update"; row: RealtimeBetRow }
  | { kind: "bet-delete"; betId: string }
  | { kind: "wager-insert"; row: WagerRow }
  | { kind: "comment-insert"; row: CommentRow }
  | { kind: "chat-insert"; row: ChatMessageRow };

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
 * kick/ban cascade, whose companion `team_members` change is not subscribed at
 * all (§5 rule 3). Applying half of either one would be worse than applying
 * neither; the pool corrects on the next load.
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

import type { ChatMessage, MutationErrorCode } from "@repo/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fail, unexpected, type MutationResult } from "./result";

/**
 * Team chat's data module — plan §8 Extra Phase 1, tasks 7 (store + reads) and
 * 8 (send path). Everything here reads or writes exactly one table,
 * `chat_messages` (20260906120000_team_chat.sql), through the one RPC that
 * table's header names as its only access path, plus the one plain insert its
 * own INSERT policy already fully authorizes.
 *
 * HARD REQUIREMENT, not a preference: nothing in this module is called from
 * `loadTeamData` (team-data.ts), and this file must never be imported there.
 * That function is already ten unbounded queries and the named egress
 * weakness (design-scale-and-free-tier.md §2.2/§4.1) — one more, on a
 * table with no natural row ceiling of its own (30-day retention aside), is
 * exactly the kind of addition that document was written to head off.
 *
 * (It said "nine" until Extra Phase 2 added `bet_duels` as the tenth. That
 * addition strengthens this rule rather than weakening it: the scale doc's
 * new "**The tenth query, and why it was allowed**" paragraph admits a table
 * only when it is bounded by something `loadTeamData` already loads — a duel
 * row is 1:1 with a `bets` row and cannot outgrow it — whereas
 * `chat_messages` is bounded by a *message rate*, which is the case that
 * paragraph explicitly refuses. The count moved; the reason chat stays out
 * did not.) Chat
 * instead loads lazily, on demand, the moment its surface (rail or modal)
 * first mounts — see `loadChat` in team-context.tsx, which calls the
 * functions below directly and is the only caller of this file.
 *
 * Two structural choices worth stating once, up front, because both differ
 * from `bet-mutations.ts`'s pattern next door:
 *
 *   - `fetchChatPage` calls an RPC (`chat_page`) rather than a plain
 *     `.from("chat_messages").select(...)`, even though this is a READ and
 *     every other read in the app (team-data.ts) is a plain select. The
 *     reason is the 30-day window predicate (D1): it must live in exactly one
 *     place, next to `app.chat_retention_interval()`, the SQL migration's own
 *     stated authority for that number. A PostgREST filter built here, in
 *     TypeScript, would be a second copy of "30 days" that could drift from
 *     the first, or simply be forgotten by a future caller who reads this
 *     file's send path and models a new read on it without noticing the
 *     window was never optional. Routing every read through the RPC makes
 *     omitting the predicate impossible rather than merely undocumented.
 *   - `sendChatMessage` IS a plain insert, no RPC — the opposite choice from
 *     every mutation in `bet-mutations.ts`. That file's `addComment` header
 *     explains the shape this mirrors: one row, no money moved, and the
 *     table's own `chat_messages_insert_own` policy (membership + authorship
 *     pinned to the caller) already states the entire rule an RPC would
 *     otherwise exist to enforce. There is nothing left for a function to do.
 */

type Client = SupabaseClient;

// --- row shape + mapper ---------------------------------------------------------
// Same explicit, hand-written mapper style as team-data.ts and bet-mutations.ts:
// the schema is Postgres's representation, `ChatMessage` (types.ts) is the
// product's model, and this is the one place that translates between them.

export interface ChatMessageRow {
  id: string;
  team_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

// --- page sizes (D4: two surfaces, one store) ------------------------------------
// The rail shows working scrollback over the most recent messages; the modal
// pages back to the 30-day edge in bigger bites because a person who opened it
// is committing to reading history, not glancing at a sidebar.

/** Rail's keyset page size (roadmap task 7). */
export const CHAT_RAIL_PAGE_SIZE = 30;

/** Modal's keyset page size (roadmap task 7) — bigger because scrolling the
 * full 30-day history one rail-sized page at a time would be its own chore. */
export const CHAT_MODAL_PAGE_SIZE = 50;

// --- flood-control error codes (task 4's trigger, task 8's mapping) --------------
// `20260906120000_team_chat.sql`'s `enforce_chat_flood_control` raises these as
// SQLSTATEs, not as message text the client pattern-matches — its own comment
// says why: a user-definable SQLSTATE is a NAME, and keying on the name rather
// than the sentence is what lets that migration's wording change tomorrow
// without silently breaking the toast this file maps it to today. Keying on
// `error.message` instead would tie this file's behavior to prose living in a
// different file in a different language, with no compiler or test able to
// catch the two drifting apart.
export const CHAT_FLOOD_RATE_SQLSTATE = "SLC01";
export const CHAT_FLOOD_DUPLICATE_SQLSTATE = "SLC02";

/** Postgres's own code for a violated CHECK constraint (`chat_messages`'s
 * `body` bound) — not a code this app defines, unlike the two above, but
 * still worth mapping by hand: the constraint's default error text names the
 * constraint (`chat_messages_body_check`) rather than saying anything a
 * member would recognize as feedback on what they typed. */
const CHECK_VIOLATION_SQLSTATE = "23514";

/**
 * One PostgrestError from a `chat_messages` write, turned into the one
 * sentence a toast can show — the app's dry voice, matching the tone
 * `bet-mutations.ts`'s RPC failures already carry (this file's own
 * `validateChatMessage` mirror never even reaches the server for these two
 * cases, since `validateChatMessage` catches them client-side first; this
 * mapping exists for the trigger's OWN limits, which have no client-side
 * mirror because they depend on rows this client cannot see — how many
 * messages this member sent in the last 10 seconds, from every one of their
 * open tabs and devices at once).
 *
 * Falls through to the raw `error.message` for anything this file does not
 * specifically recognize — a network hiccup, an RLS rejection, a schema
 * change — because a message this module has no better sentence for is still
 * better shown than swallowed.
 */
function asChatFailure(error: PostgrestError): MutationResult {
  if (error.code === CHAT_FLOOD_RATE_SQLSTATE) {
    return fail("chat-rate-limited");
  }
  if (error.code === CHAT_FLOOD_DUPLICATE_SQLSTATE) {
    return fail("chat-duplicate");
  }
  if (error.code === CHECK_VIOLATION_SQLSTATE) {
    return fail("chat-invalid");
  }
  return unexpected(error);
}

// --- ids --------------------------------------------------------------------------

/**
 * A fresh id for a chat message, minted on the CLIENT before the row exists
 * (task 8) — see `sendChatMessage` for why the id has to originate here
 * rather than come back from the insert.
 *
 * Deliberately `crypto.randomUUID()`, NOT `@repo/shared`'s `generateId`.
 * `generateId(prefix)` returns `${prefix}-<uuid>` (e.g. `b-3f2a851c-…`) — a
 * string built for this app's other entity ids, none of which are stored in a
 * Postgres `uuid` column. `chat_messages.id` IS declared `uuid primary key`
 * (20260906120000_team_chat.sql), and `generateId`'s prefixed output is not a
 * valid `uuid` literal — Postgres would reject every insert at the type-cast
 * stage before RLS or the flood trigger even ran. This is the one id in the
 * app that bypasses `generateId`, and it does so because the column's type
 * disagrees with that helper's shape, not because chat gets special treatment.
 */
export function newChatMessageId(): string {
  return crypto.randomUUID();
}

// --- keyset cursor + page ---------------------------------------------------------

/** The oldest row of a fetched page, and the next `before` to fetch past it. */
export interface ChatPageCursor {
  createdAt: string;
  id: string;
}

export interface ChatPage {
  /** ASCENDING (oldest first) — the order both the rail and the modal render. */
  messages: ChatMessage[];
  /** The oldest row of THIS page; pass it back as `before` for the next one. */
  cursor: ChatPageCursor | null;
  hasMore: boolean;
}

/**
 * One keyset page of a team's chat, oldest-first once it leaves this
 * function — reads the `chat_page` RPC, never the table directly (see this
 * file's header for why the RPC and not a plain select).
 *
 * `chat_page` itself returns rows NEWEST-first (`order by created_at desc, id
 * desc`) because that is the direction keyset paging naturally walks: each
 * page's oldest row becomes the next page's "before" cursor without a second
 * sort. This function reverses that into ascending order before returning,
 * because ascending is the order every render surface wants — the wire
 * format and the render order are allowed to differ, and here they do, on
 * purpose, in exactly one place.
 *
 * Absent `input.before` means "the newest page" — both `p_before_created_at`
 * and `p_before_id` go over as `null`, which `chat_page`'s own default
 * parameters and `is null` check treat as "no lower bound."
 *
 * `hasMore` is `rows.length === limit`: a full page might be followed by
 * another; a short page (or an empty one) is the end, whether that end is the
 * 30-day retention edge or simply the first message the team ever sent.
 */
export async function fetchChatPage(
  supabase: Client,
  input: { teamId: string; before?: ChatPageCursor | null; limit?: number },
): Promise<{ page: ChatPage | null; error: MutationErrorCode | null }> {
  const limit = input.limit ?? CHAT_RAIL_PAGE_SIZE;

  const { data, error } = await supabase.rpc("chat_page", {
    p_team_id: input.teamId,
    p_before_created_at: input.before?.createdAt ?? null,
    p_before_id: input.before?.id ?? null,
    p_limit: limit,
  });

  // D9's read-path twin: the RPC's own text is logged, never rendered.
  if (error) {
    console.error(
      `[chat] page read failed ${error.code ?? "(no SQLSTATE)"}: ${error.message}`,
    );
    return { page: null, error: "chat-load-failed" };
  }

  const newestFirst = (data ?? []) as ChatMessageRow[];
  const ascending = [...newestFirst].reverse();
  const oldest = ascending[0];

  return {
    page: {
      messages: ascending.map(toChatMessage),
      cursor: oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
      hasMore: newestFirst.length === limit,
    },
    error: null,
  };
}

// --- send -------------------------------------------------------------------------

/**
 * Send one chat message (task 8) — a plain insert, not an RPC; see this
 * file's header for why that is the right shape here and not a hidden
 * shortcut.
 *
 * `input.id` is generated by the CALLER, via `newChatMessageId` above, BEFORE
 * this function is invoked — not assigned by the database's own `default
 * gen_random_uuid()`. This is the load-bearing part of task 8's optimistic
 * send: the caller writes an optimistic row into `team-context.tsx`'s state
 * using this same id, then this insert lands, then the Realtime INSERT event
 * for this very row arrives back over the wire (`chat-insert` in
 * `realtime.ts`). Without a client-known id, that echo could only be matched
 * by comparing body text and timestamp — fragile the moment two people send
 * the same word at once, or a clock disagrees by a few hundred milliseconds.
 * With the id fixed before either write happens, the receive side's rule is
 * simply "ignore any id already held," which is both correct and sufficient:
 * it dedupes the sender's own echo AND any double delivery, with one check,
 * for every caller of that rule, not just this one.
 *
 * Selects back `created_at` ONLY — never the browser's clock. Exactly the
 * reason `create_bet` (bet-mutations.ts) round-trips `closes_at` rather than
 * trusting a local `Date.now()`: the server's clock is the one every other
 * member's `chat_page` read will agree on, and an optimistic row must be
 * corrected to that value the moment the real one is known, or its position
 * in a list ordered by `created_at` could end up wrong relative to a message
 * that arrives from someone else in between.
 */
export async function sendChatMessage(
  supabase: Client,
  input: { id: string; teamId: string; userId: string; body: string },
): Promise<MutationResult & { message?: { createdAt: string } }> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      id: input.id,
      team_id: input.teamId,
      user_id: input.userId,
      body: input.body,
    })
    .select("created_at")
    .single();

  if (error) return asChatFailure(error);

  const row = data as { created_at: string };
  return { ok: true, message: { createdAt: row.created_at } };
}

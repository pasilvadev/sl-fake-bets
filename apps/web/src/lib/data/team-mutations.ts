import {
  CONFIG,
  generateInviteCode,
  type MutationErrorCode,
  type TeamAccessMode,
  type ProfileDraft,
} from "@repo/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, unexpected, type MutationResult } from "./result";

/**
 * The write half of the Postgres data layer (roadmap Phase 5).
 *
 * Team shape changes go through the SECURITY DEFINER RPCs added in
 * `20260905140000_team_rpcs.sql` — see that file's header for why a client
 * cannot issue them as table writes. Single-row changes that RLS already
 * describes completely (access mode, team deletion, profile edits) stay plain
 * table writes; routing those through an RPC too would add a function whose
 * whole body is the policy that already exists.
 *
 * `invite_codes` (`plan-invite-links.md` D4, `20260907150000_invite_links.sql`)
 * used to be the one exception — a direct client INSERT — and no longer is:
 * both `createInviteCode` and `revokeInviteCode` below are RPCs now, because
 * the expiry timestamp must come from the server's clock (D2), the
 * one-permanent and cap rules (D6/D8) must be checked inside the same
 * transaction as the insert, and the reason `invite_codes` was ever a direct
 * write — nothing needed the extra function — is gone.
 *
 * Every function here returns MutationResult rather than throwing: a failure
 * from this layer is almost always a rule the user tripped ("You are already in
 * that team"), which the modals render inline. The RPCs raise those with a
 * human sentence for exactly that reason.
 */

type Client = SupabaseClient;

/** Postgres unique-violation — the invite-code collision retry below. */
const UNIQUE_VIOLATION = "23505";

/**
 * `create_invite_code`'s two named refusals (`plan-invite-links.md` D6/D8,
 * `20260907150000_invite_links.sql`) — a second live permanent link, and the
 * tenth-plus live 24-hour link. Named the same way `bet-mutations.ts` names
 * `DUEL_PENDING_CAP_SQLSTATE`/`DUEL_DUPLICATE_PAIR_SQLSTATE`: a SQLSTATE is a
 * NAME the migration can reword its `raise` sentence around tomorrow without
 * silently breaking the toast mapped to it today, which matching on
 * `error.message` could never promise (D9).
 */
const INVITE_PERMANENT_EXISTS_SQLSTATE = "SLI01";
const INVITE_TEMP_CAP_SQLSTATE = "SLI02";

function asFailure(error: PostgrestError): MutationResult {
  return unexpected(error);
}

/**
 * One `PostgrestError` from `create_invite_code`, turned into the sentence a
 * toast can show — same shape as `bet-mutations.ts`'s `asDuelFailure`, and the
 * same rule: keyed on SQLSTATE only, never on message text, because the 125
 * `raise exception` strings across `supabase/migrations` are the last line of
 * defence against races and tampering, not 125 translated sentences, and
 * pattern-matching `error.message` would start failing silently the day
 * someone reworded a migration (D9). Everything else — including a plain
 * `23505` this function's own retry loop (`withFreshCode`) did not absorb —
 * falls through to `unexpected`.
 */
function asInviteFailure(error: PostgrestError): MutationResult {
  if (error.code === INVITE_PERMANENT_EXISTS_SQLSTATE) {
    return fail("invite-permanent-exists");
  }
  if (error.code === INVITE_TEMP_CAP_SQLSTATE) {
    // Interpolated from CONFIG, never typed into the string, for the same
    // reason `asDuelFailure` interpolates `duel-pending-cap` from CONFIG: a
    // sentence that said "10" while the constant said something else would be
    // a lie the type system could not see. The SQL side counts against its
    // own copy of the same number (`app.invite_max_live_temporary_per_team()`).
    return fail("invite-temp-cap", {
      values: { max: CONFIG.INVITE_MAX_LIVE_TEMPORARY_PER_TEAM },
    });
  }
  return unexpected(error);
}

/**
 * The five-attempt retry against a generated invite code colliding with an
 * existing one (`23505`) — DOM-001/002 + DOM-021's original shape in
 * `createTeam`, factored out because `plan-invite-links.md`'s
 * `createInviteCode` needs the exact same retry for the exact same reason. A
 * member cannot SELECT other teams' invite codes (RLS), so proving uniqueness
 * by reading every existing code first is not an option — `id.ts`'s alphabet
 * is sized so that trying, and retrying on the rare collision, is proof enough.
 *
 * `attempt` is handed a freshly generated code on every try and returns
 * whatever its own RPC call returns, untouched: this function only decides
 * whether to retry (another `23505`), stop with whatever the RPC said
 * (success or any other failure), or give up after five tries — `null`, which
 * every caller turns into `fail("invite-code-failed")`, since "the whole
 * namespace is somehow exhausted" has no better sentence than that one.
 */
async function withFreshCode<T>(
  attempt: (
    code: string,
  ) => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<{ data: T | null; error: PostgrestError | null } | null> {
  for (let attemptCount = 0; attemptCount < 5; attemptCount++) {
    const result = await attempt(generateInviteCode([]));
    if (!result.error || result.error.code !== UNIQUE_VIOLATION) return result;
  }
  return null;
}

/**
 * DOM-001/002 + DOM-021. The code is generated client-side (id.ts owns its
 * alphabet and format) and proven unique by the table's UNIQUE index rather
 * than by reading every existing code first — a member cannot SELECT other
 * teams' invite codes, so a client-side uniqueness check would be checking
 * against a list of one.
 */
export async function createTeam(
  supabase: Client,
  draft: { name: string; accessMode: TeamAccessMode },
): Promise<MutationResult & { teamId?: string }> {
  const result = await withFreshCode((code) =>
    supabase.rpc("create_team", {
      p_name: draft.name.trim(),
      p_access_mode: draft.accessMode,
      p_invite_code: code,
    }),
  );
  if (!result) return fail("invite-code-failed");
  if (result.error) return asFailure(result.error);
  return { ok: true, teamId: result.data as string };
}

/**
 * `plan-invite-links.md` D2/D4/D6/D8: mint one link, permanent or 24-hour.
 * `create_invite_code` is where the expiry is actually decided — `temporary`
 * only names which the caller asked for; the deadline itself is
 * `now() + app.invite_temporary_ttl()`, stamped by the server, never by a
 * client clock a wrong device could lie with. The same `withFreshCode` retry
 * `createTeam` uses covers the code collision here too, and D8's own comment
 * explains why a concurrent second permanent is still safe: it lands as
 * `23505` on the unique index, the retry's next attempt tries a fresh code
 * against the *same* rule, and that attempt is what surfaces `SLI01` —
 * self-correcting, not a bug to guard against twice.
 */
export async function createInviteCode(
  supabase: Client,
  input: { teamId: string; temporary: boolean },
): Promise<MutationResult & { inviteId?: string }> {
  const result = await withFreshCode((code) =>
    supabase.rpc("create_invite_code", {
      p_team_id: input.teamId,
      p_code: code,
      p_temporary: input.temporary,
    }),
  );
  if (!result) return fail("invite-code-failed");
  if (result.error) return asInviteFailure(result.error);
  return { ok: true, inviteId: result.data as string };
}

/**
 * `plan-invite-links.md` D4/D5: revoke one link. `canRevokeInvite`
 * (`packages/shared/src/permissions.ts`) is the client's advisory copy of who
 * may act; `revoke_invite_code` is the enforcement, and its three named
 * refusals (link gone, not on the roster, neither moderator/leader nor the
 * link's own creator) all fall through to `unexpected` here rather than
 * getting their own codes — `team-context.tsx`'s `revokeInvite` already
 * refuses `creator-or-mod-only-revoke-invite` client-side before this call
 * ever fires, so every refusal that reaches this function is either a stale
 * screen or a race, not a rule an ordinary user is meant to trip.
 */
export async function revokeInviteCode(
  supabase: Client,
  inviteId: string,
): Promise<MutationResult> {
  const { error } = await supabase.rpc("revoke_invite_code", {
    p_invite_id: inviteId,
  });
  return error ? unexpected(error) : ok;
}

/** UX-005/DOM-005 + A-4, all decided inside the RPC (see its header). */
export async function joinTeamByCode(
  supabase: Client,
  code: string,
): Promise<MutationResult & { teamId?: string }> {
  const { data, error } = await supabase.rpc("join_team_with_code", {
    p_code: code.trim(),
  });
  return error ? asFailure(error) : { ok: true, teamId: data as string };
}

export interface TeamPreview {
  teamId: string;
  teamName: string;
  memberCount: number;
  openBetCount: number;
  isMember: boolean;
  isBanned: boolean;
}

/** UX-023: what an invite link shows before you are a member of anything. */
export async function previewTeamByCode(
  supabase: Client,
  code: string,
): Promise<{ preview: TeamPreview | null; error: string | null }> {
  const { data, error } = await supabase
    .rpc("team_preview_by_code", { p_code: code.trim() })
    .maybeSingle();

  if (error) return { preview: null, error: error.message };
  if (!data) return { preview: null, error: null };

  const row = data as {
    team_id: string;
    team_name: string;
    member_count: number;
    open_bet_count: number;
    is_member: boolean;
    is_banned: boolean;
  };
  return {
    error: null,
    preview: {
      teamId: row.team_id,
      teamName: row.team_name,
      memberCount: row.member_count,
      openBetCount: row.open_bet_count,
      isMember: row.is_member,
      isBanned: row.is_banned,
    },
  };
}

/**
 * DOM-031/032 kick, ban, and self-exit. `wagerIds` is settlement.ts's verdict
 * on the cascade (decision §4.4), computed by the caller from the loaded bets
 * and wagers — the RPC applies it, re-scoped to this team and this user.
 */
export async function removeMembership(
  supabase: Client,
  input: { teamId: string; userId: string; ban: boolean; wagerIds: string[] },
): Promise<MutationResult> {
  const { error } = await supabase.rpc("remove_membership", {
    p_team_id: input.teamId,
    p_user_id: input.userId,
    p_ban: input.ban,
    p_wager_ids: input.wagerIds,
  });
  return error ? asFailure(error) : ok;
}

/** DOM-024/025: leader-only credit + its ledger row, in one transaction. */
export async function injectCoins(
  supabase: Client,
  input: { teamId: string; userId: string; amount: number },
): Promise<MutationResult & { balanceAfter?: number }> {
  const { data, error } = await supabase.rpc("inject_coins", {
    p_team_id: input.teamId,
    p_user_id: input.userId,
    p_amount: input.amount,
  });
  return error ? asFailure(error) : { ok: true, balanceAfter: data as number };
}

export interface DailyReward {
  /** Its own uuid and the server's clock — the ledger row, as written. */
  transactionId: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

/**
 * DOM-022 / A-2 / decision §4.3 (roadmap Phase 7): the unconditional daily
 * reward, once per (user, team, calendar day in UTC), claimed lazily whenever
 * a team loads. Calling it a second time is not an error and not a no-op to
 * apologise for — it is the normal case, and it comes back with no reward.
 *
 * Idempotence is the database's, not this function's: the partial unique index
 * on `transactions` is the arbiter, so two tabs opening at once still grant one
 * reward.
 */
export async function claimDailyReward(
  supabase: Client,
  teamId: string,
): Promise<MutationResult & { reward?: DailyReward }> {
  const { data, error } = await supabase.rpc("claim_daily_reward", {
    p_team_id: teamId,
  });

  if (error) return asFailure(error);

  const row = data as {
    granted: boolean;
    transaction_id?: string;
    amount?: number;
    balance_after?: number;
    created_at?: string;
  };
  if (!row.granted) return ok;

  return {
    ok: true,
    reward: {
      transactionId: row.transaction_id!,
      amount: row.amount!,
      balanceAfter: row.balance_after!,
      createdAt: row.created_at!,
    },
  };
}

/** DOM-002: access mode — a one-row update the `teams` UPDATE policy covers. */
export async function updateTeamSettings(
  supabase: Client,
  input: { teamId: string; accessMode: TeamAccessMode },
): Promise<MutationResult> {
  const { error } = await supabase
    .from("teams")
    .update({ access_mode: input.accessMode })
    .eq("id", input.teamId);
  return error ? asFailure(error) : ok;
}

/**
 * DOM-033 hard delete. Everything the team owns — memberships, bets, options,
 * wagers, comments, ledger, invite codes, bans — is removed by ON DELETE
 * CASCADE, so this really is one statement. Balances are per-team (DOM-013);
 * nothing survives to refund.
 */
export async function deleteTeam(
  supabase: Client,
  teamId: string,
): Promise<MutationResult> {
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  return error ? asFailure(error) : ok;
}

/**
 * UX-022 profile edit — own row only, per the `users` UPDATE policy.
 *
 * `onboardedAt` folds roadmap Phase 7.5's first-run stamp into the SAME update
 * rather than firing a second write after it: saving from the first-run step is
 * one decision by the user, and two round trips could leave the profile saved
 * with the step still owed, which would show it again over a profile that is
 * already correct.
 */
export async function updateProfile(
  supabase: Client,
  userId: string,
  draft: ProfileDraft,
  options: { onboardedAt?: string } = {},
): Promise<MutationResult> {
  const { error } = await supabase
    .from("users")
    .update({
      display_name: draft.displayName.trim(),
      name_color: draft.nameColor,
      avatar: draft.avatar,
      ...(options.onboardedAt ? { onboarded_at: options.onboardedAt } : {}),
    })
    .eq("id", userId);
  return error ? asFailure(error) : ok;
}

/**
 * Phase 7.5's skip: the first-run step is done and the profile is untouched.
 * `onboarded_at` is a marker, not an audited timestamp, so the client's clock
 * is good enough — PostgREST cannot call `now()` in an update value, and
 * inventing an RPC whose whole body is `users_update_self` would add a function
 * to say what the policy already says.
 */
export async function markOnboarded(
  supabase: Client,
  userId: string,
  onboardedAt: string,
): Promise<MutationResult> {
  const { error } = await supabase
    .from("users")
    .update({ onboarded_at: onboardedAt })
    .eq("id", userId);
  return error ? asFailure(error) : ok;
}

/** Bytes an avatar upload may carry — mirrors the bucket's file_size_limit. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * UX-022's custom avatar image, into Phase 3's public `avatars` bucket.
 *
 * The object key starts with the uploader's uuid because that first path
 * segment IS the storage authorization boundary (see the bucket's policies) —
 * it is what lets a write policy tell "my avatar" from "someone else's" with no
 * lookup table. The rest of the key is timestamped rather than fixed so a new
 * upload cannot be served from a cache of the old one under the same URL.
 */
export async function uploadAvatar(
  supabase: Client,
  userId: string,
  file: File,
): Promise<{ url: string | null; error: MutationErrorCode | null }> {
  if (file.size > AVATAR_MAX_BYTES) {
    return { url: null, error: "avatar-too-large" };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${userId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });
  // D9 again, in the one shape that is not a `MutationResult`: Storage's own
  // message is as un-showable as PostgREST's, so it is logged and the reader
  // gets the generic sentence.
  if (error) {
    console.error("[avatar] upload failed:", error.message);
    return { url: null, error: "unexpected" };
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

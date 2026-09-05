import {
  generateInviteCode,
  type TeamAccessMode,
  type ProfileDraft,
} from "@repo/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type MutationResult } from "./result";

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
 * Every function here returns MutationResult rather than throwing: a failure
 * from this layer is almost always a rule the user tripped ("You are already in
 * that team"), which the modals render inline. The RPCs raise those with a
 * human sentence for exactly that reason.
 */

type Client = SupabaseClient;

/** Postgres unique-violation — the invite-code collision retry below. */
const UNIQUE_VIOLATION = "23505";

function asFailure(error: PostgrestError): MutationResult {
  return fail(error.message);
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
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.rpc("create_team", {
      p_name: draft.name.trim(),
      p_access_mode: draft.accessMode,
      p_invite_code: generateInviteCode([]),
    });
    if (!error) return { ok: true, teamId: data as string };
    if (error.code !== UNIQUE_VIOLATION) return asFailure(error);
  }
  return fail("Could not generate a unique invite code — try again.");
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
): Promise<{ url: string | null; error: string | null }> {
  if (file.size > AVATAR_MAX_BYTES) {
    return { url: null, error: "Image must be 2 MB or smaller." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${userId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) return { url: null, error: error.message };

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

# In this doc I will list bugs or changes I found that are needed but I couldn't ask for a fix at the time. Every bug or change listed here that was already dealt with should be removed, not tagget or anything, straight up removed, I dont want agent comments here, just the list I make and it should be cleared if anything here is not bugged or as described on live anymore.

## Betting into negative balance

Users can end up with a negative coin balance, and once negative they're locked out of betting entirely (any positive wager amount is always ">" a negative balance, so `place_wager` rejects it). My first guess was a single wager could exceed the current balance (e.g. balance 100, bet 200 goes through), but that check looks correct everywhere I found it:
- `supabase/migrations/20260905150000_bet_rpcs.sql` `place_wager`: locks the balance row (`for update`) then `if p_amount > v_balance then raise exception 'Not enough coins.'`
- `supabase/migrations/20260906130100_duel_rpcs.sql` `create_duel` and `accept_duel`: same `p_stake > v_balance` gate, also under a row lock
- `apps/web/src/components/modals/wager-modal.tsx`: the amount input/chips/max-button all clamp to `cap = min(balance, remainingMax)`, so the modal itself won't let you type more than your balance

The actual known way to go negative is `supabase/migrations/20260905160000_delete_bet_may_overdraw.sql`: `public.delete_bet` deliberately claws back a paid-out win by setting `app.allow_negative_balance = on` and can overdraw a member who already spent the payout. That's documented as an intentional owner ruling (deleting a *resolved* bet), not a placement bug — but need to confirm whether that's actually the path that's happening on live, or whether there's another route (duel accept/decline, resolution/payout math, a stale/cached balance in a client that lets a wager submit against an old higher balance) that's letting people go negative from ordinary play. Whoever picks this up should reproduce it first to find the actual trigger before deciding the fix (options once confirmed: stop `delete_bet` from overdrawing and settle the difference another way, and/or add a recovery path other than waiting on a leader's `inject_coins`).

## Richest/poorest leaderboard wrong

`apps/web/src/lib/team-context.tsx` (~line 3177-3178) builds both lists off `team.members`:
```
const richest = [...team.members].sort((a, b) => b.coinBalance - a.coinBalance);
const poorest = [...team.members].sort((a, b) => a.profitLoss - b.profitLoss);
```
"Richest" sorts by current coin balance (descending) but "poorest" sorts by `profitLoss` (net win/loss standing) instead of balance — it's not the mirror-image bottom-N of richest, it's a totally different metric. So someone with a low/negative balance who hasn't had a bet resolve yet won't show up as poorest, and someone with a healthy balance but bad realized P/L will show up at the top of "poorest". Consumed as-is (no bug in the consumers) by `apps/web/src/components/dashboard/rail/standings-module.tsx:111` (`.slice(0, 5)`) and `apps/web/src/components/modals/standings-full-modal.tsx:28` (full list, no slice).

If "poorest" is supposed to be bottom-N by balance (mirroring richest), the sort key at team-context.tsx line 3178 needs to change to balance ascending (`a.coinBalance - b.coinBalance`). If "poorest" is intentionally the P/L-based "podium of the poor" (this is what the type comment on `profitLoss` in `packages/shared/src/types.ts` and DOM-028 in `agent-docs/AGENT_SPEC.md` describe), then the list isn't bugged so much as mislabeled/confusing, and it's a product call which behavior we actually want — needs a decision, not just a fix.


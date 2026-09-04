# Design: Dashboard (logged-in home)

**Status: implemented Phase-1 (mock data), 2026-09-04.** Decision process: 3 independent IA proposals (data-density / retention / shell-scalability lenses), adversarially judged by 2 judges against AGENT_SPEC + `design-visual-identity.md`. Winner: **"Feed & Pulse Rail"** (data-density), with grafts from the losers noted in §5. Visual identity doc remains binding for all styling; this doc owns the dashboard's information architecture.

## 1. Shell — no nav sidebar, three horizontal bands

The app is one dashboard + one bet-detail page (UX-015); everything else is a modal (UX-014/016). A nav sidebar would list destinations that don't exist — its pixels go to a data-carrying right rail instead.

Grid rows: **top bar 56px (sticky)** · **stat ticker 40px (not sticky)** · **body**.

### 1.1 Top bar (`sticky top-0`, `bg-surface-1 border-b`)
Left: SL S-mark (20px, currentColor) · **team switcher** trigger (team initial chip + name + chevron) opening a popover:
- One row per team in `mockTeams`: 3px jade left rail on the active row (reuses the bet-row rail motif — no second "selected" language), team name, per-team open-bet count (mono), and a reserved slot for a future per-team notification pip (ARC-015).
- Footer: "Create a team" row (modal stub) + **inline** "Join with invite code" input (one fewer hop than a modal; graft from retention proposal).
- Switching re-scopes everything (UX-010): feed, balance, ticker, rail, all via `TeamProvider` context.

Right, fixed order:
1. **Balance pill** — coin glyph + mono balance (current team, DOM-013); jade `+5` micro-tag docked for the daily grant (DOM-022/A-2 — automatic, never a claim button); click opens Wallet popover-equivalent (transactions modal).
2. **Invite Friends** (outline) → invite modal (UX-023 preview).
3. **Create Bet** (primary jade/black, `rounded-sm`, **no cut-sm here** — see §3 scarcity ruling) → create-bet modal. Disabled with tooltip when team is `restricted` and user is a plain member (DOM-002/006).
4. **Notifications bell** — permanent slot, `opacity-40 pointer-events-none`, tooltip "Notifications — coming soon" (ARC-014/015 future-stub).
5. **Profile avatar** (rounded-full, 1px ring in own name-color) → dropdown: Edit Profile (modal, UX-022) · Team Settings (leader/mod) / Team Info (member) · Leave team (ordinary-destructive style) · Language: English (inert stub, UX-027) · Sign out (inert Phase 1).

### 1.2 Stat ticker (40px, scrolls away, `bg-surface-0`, `overflow-x-auto` single line)
Mono `tabular-nums` chips split by vertical hairlines, pure readout, no click targets: `OPEN n` · `CLOSING SOONEST {countdown}` (jade, the strip's only live numeral) · `POOL (OPEN) n` · `YOUR RANK #n RICHEST` · `TEAM n/30`.

### 1.3 Body ≥1024px
2-col grid `minmax(0,1fr) 380px`, gap 24px, `max-w-[1600px] mx-auto`, padding 24px. Rail is `sticky top-[96px]` with own scroll. 1024–1279px: rail 320px, gap 16px.

## 2. Main column — Bet Feed

Header row: contextual eyebrow (`OPEN BETS` / per filter) + segmented control `All | Open | Closed | Resolved` (slash-notch active tick, §5.8; "All" default). Below: edge-to-edge §5.1 bet rows (rail / icon chip 44px / title + by-creator / odds preview with jade `/` join / POOL + countdown / avatar stack / WAGER CTA → wager modal UX-016; row body → bet-detail UX-015 — Phase 1: `href="#"` placeholder). A small ghost **share** icon sits with the CTA cluster (UX-024 home; Phase 1 copies a fake link).

Grouping (eyebrow + hairline break, never color-only): **OPEN** soonest-closing first (UX-008) → **CLOSED / AWAITING RESULT** most-recent first → **RESOLVED** most-recent first. Empty group = omitted.

Resolved rows: winner option jade `/` + N8 600-weight, losers N6 400 + line-through odds; user's own outcome replaces CTA: `/ WON +n` jade mono or `\ LOST n` N6 mono; non-participant = neutral, no glyph.

## 3. Scarcity ruling (documented exception to §4.3/§5.3/§5.6 co-occurrence)

The dashboard's **one** diagonal cut = the single soonest-closing OPEN row (icon chip + CTA `cut-sm` + 6% jade corner tint + pulsing rail when <1h). Therefore, on this screen: top-bar Create Bet renders flat (`rounded-sm`), leaderboard teaser rank-1 renders flat. `cut-sm` on the primary CTA is legitimate only where no competing cut exists (empty-state CTA); rank-1 `cut-sm` lives in the full-leaderboard modal (own viewport budget). Deliberate, not silent divergence (AGENT_SPEC §0).

## 4. Pulse Rail (4 modules, top→bottom by check-frequency)

1. **Wallet** — big mono balance numeral (N8) + coin glyph; "Daily login: +5 today ✓" line (auto-grant); "Your P/L" slash-glyph line (DOM-026); "View transaction history" → modal (DOM-025 dense rows: date · description · delta · balance-after); disabled **Donate Coins** button, tooltip "Coming soon" (DOM-023 future-stub; the long-term home is also a per-name user popover — post-MVP).
2. **Standings** — segmented tab **Richest** (default, DOM-027) / **Poorest** (DOM-028): same compact row shape (rank digit mono, avatar, name in own name-color + inline parallelogram rank badge DOM-029, amount right mono). Top 5 + "View full leaderboard" → modal. Poorest carries dry copy (rank-1 tagline "House's favorite donor"; all-zero P/L → "Everyone's still solvent. Suspicious.").
3. **Team** — "n / 30 members", avatar cluster (max 6 + `+N`), Invite button (redundant entry, expected here), **Manage Team** (leader/mod → Team Settings modal: access-mode toggle DOM-002, roster with kick/ban DOM-031 ember ordinary-destructive, leader-only per-row Inject Coins DOM-024, danger zone type-to-confirm delete DOM-033/034) / **View Team** (member, read-only variant).
4. **Team Chat (future-stub, UX-019)** — `TEAM CHAT` eyebrow + neutral `SOON` tag; 1–2 greyed real-anatomy chat rows (§5.7); disabled input with `/` send glyph drawn. Distinct from per-bet chat (UX-018, bet-detail only).

## 5. Grafts adopted from losing proposals
- Richest/Poorest as one tabbed module (retention proposal).
- Inline join-code input in switcher popover (retention).
- Reserved per-team notification pip slot in switcher rows (shell proposal).
- 3px jade rail as active-team indicator (shell).
- Access-mode gating of Create Bet/Invite computed in the shell, not implicit in the modal (shell).
- Judge-gap fixes: bet-row share affordance (UX-024), "Leave team" home, language stub (UX-027), all bespoke animations wrapped in `prefers-reduced-motion`.

## 6. Responsive tiers (one structural swap only)
- **≥1280px** full grid. **1024–1279px** rail 320px.
- **768–1023px** rail column removed → **module chip strip** (~56px, horizontal scroll) under the ticker: Wallet / Standings / Team / Chat(SOON) chips, each opening its module as a bottom sheet (mirrored `cut-md`, §5.4). Feed full width.
- **<768px** top bar keeps S-mark + switcher + balance + avatar (Invite & bell move into avatar sheet); **Create Bet becomes a 56px circular jade FAB** bottom-right (circle sanctioned via §4.1 icon-button exception; it also frees the one-cut budget for the closing-soon row). Bet rows use §5.1 stacked mobile layout (~96px). Modals = bottom sheets.

## 7. Empty & loading
- Zero-bets team (t-02/t-03 exercise this live): ghost S-mark watermark 5% + "No bets yet. Someone has to make the first bad decision." + Create Bet CTA (`cut-sm` legitimate here).
- Zero transactions: "No transactions yet."; all-zero P/L: solvent line (§4.2 copy).
- Skeletons: row-shaped, opacity-breathe 0.4↔0.6, no shimmer.

## 8. Phase-1 implementation map (`apps/web/src`)
- `lib/team-context.tsx` (current team/user/role state), `lib/modal-context.tsx` (single modal mount), `lib/format.ts` (coins, countdown, dates).
- `components/sl/`: `s-mark`, `coin-amount` (glyph + mono, delta variant `/ +n` · `\ −n`), `user-name` (name-color + rank badge), `rank-badge` (parallelogram), `avatar-cluster`, `modal-shell` (§5.4 chrome).
- `components/shell/`: `top-bar`, `team-switcher`, `ticker`, `profile-menu`.
- `components/dashboard/`: `bet-feed`, `bet-row`, `empty-state`; `rail/`: `wallet-module`, `standings-module`, `team-module`, `chat-stub-module`, `module-chip-strip`.
- `components/modals/`: functional-with-mock bodies for `wager`, `create-bet`, `invite`, `standings-full`, `transactions`; shaped-but-inert for `profile`, `team-settings`, `create-team`.
- Modals mutate nothing (Phase 1, ARC-010/013): client state only, resets on reload.

Known deferred surfaces (not dashboard scope): logged-out landing (UX-017), bet-detail page (UX-015), crowd-resolution placeholder (DOM-020, belongs to bet-detail).

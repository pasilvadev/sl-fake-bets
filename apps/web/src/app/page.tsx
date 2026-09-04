import {
  CONFIG,
  getPoolStats,
  getUser,
  mockBets,
  mockComments,
  mockTeam,
  mockUsers,
  mockWagers,
  type Bet,
} from "@repo/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * Phase-1 proof page: renders mock data from @repo/shared end to end.
 * This is NOT the product UI — it only proves the dev pipeline works
 * (shared package → Next transpile → shadcn/Tailwind rendering).
 */

function stateOrder(bet: Bet): number {
  return bet.state === "open" ? 0 : bet.state === "closed" ? 1 : 2;
}

// UX-008: open bets first (soonest-closing first), then closed/resolved.
const sortedBets = [...mockBets].sort(
  (a, b) =>
    stateOrder(a) - stateOrder(b) || a.closesAt.localeCompare(b.closesAt),
);

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">SL Fake Bets</h1>
        <p className="text-muted-foreground text-sm">
          Phase 1 dev-environment proof — all data below is mock placeholder
          data from <code>@repo/shared</code>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{mockTeam.name}</span>
            <Badge variant="outline">{mockTeam.accessMode}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {mockTeam.members.length} members (target{" "}
            {CONFIG.TEAM_TARGET_SIZE}) · onboarding grant{" "}
            {CONFIG.ONBOARDING_GRANT_COINS} coins · daily reward{" "}
            {CONFIG.DAILY_REWARD_COINS} coins
          </p>
          <div className="flex flex-wrap gap-2">
            {mockTeam.members.map((member) => {
              const user = getUser(member.userId);
              if (!user) return null;
              const isLeader = member.userId === mockTeam.leaderId;
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 rounded-md border px-2 py-1"
                >
                  <Avatar className="size-6">
                    <AvatarFallback className="text-xs">
                      {user.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">
                    {user.displayName}
                  </span>
                  {isLeader && <Badge>leader</Badge>}
                  {member.role === "moderator" && (
                    <Badge variant="secondary">mod</Badge>
                  )}
                  <span className="text-muted-foreground text-xs">
                    {member.coinBalance} coins
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Bets ({sortedBets.length})</h2>
        {sortedBets.map((bet) => {
          const pool = getPoolStats(bet, mockWagers);
          const poolTotal = pool.reduce((sum, o) => sum + o.total, 0);
          const comments = mockComments.filter((c) => c.betId === bet.id);
          const creator = getUser(bet.creatorId);
          return (
            <Card key={bet.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>
                    {bet.iconEmoji} {bet.title}
                  </span>
                  <Badge
                    variant={bet.state === "open" ? "default" : "outline"}
                  >
                    {bet.state}
                  </Badge>
                </CardTitle>
                <p className="text-muted-foreground text-xs">
                  by {creator?.displayName} · closes {bet.closesAt} · max{" "}
                  {bet.maxWagerPerUser}/user · pool {poolTotal} coins
                  {bet.resolution?.kind === "void" && " · voided, refunded"}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1">
                  {pool.map((option) => {
                    const won =
                      bet.resolution?.kind === "winner" &&
                      bet.resolution.winningOptionId === option.optionId;
                    return (
                      <li
                        key={option.optionId}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="flex items-center gap-2">
                          {option.label}
                          {won && <Badge>winner</Badge>}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {option.total} coins ·{" "}
                          {(option.share * 100).toFixed(0)}% ·{" "}
                          {option.multiplier
                            ? `${option.multiplier.toFixed(2)}x`
                            : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {comments.length > 0 && (
                  <>
                    <Separator />
                    <ul className="space-y-1">
                      {comments.map((comment) => {
                        const author = getUser(comment.userId);
                        return (
                          <li key={comment.id} className="text-sm">
                            <span className="font-medium">
                              {author?.displayName}:
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {comment.body}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <footer className="text-muted-foreground pb-8 text-xs">
        {mockUsers.length} mock users · {mockWagers.length} mock wagers ·{" "}
        {mockComments.length} mock comments
      </footer>
    </main>
  );
}

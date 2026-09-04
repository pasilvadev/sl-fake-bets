import type { Metadata } from "next";
import { BetDetailPage } from "@/components/bet/bet-detail-page";

export const metadata: Metadata = {
  title: "Bet — SL",
};

/**
 * UX-015: the one allowed full-page view — bet detail. Data lives in the
 * client-side TeamProvider (root layout), so this route only unwraps params.
 */
export default async function BetRoute({ params }: PageProps<"/bet/[id]">) {
  const { id } = await params;
  return <BetDetailPage betId={id} />;
}

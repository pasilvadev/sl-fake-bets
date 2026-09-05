import type { Metadata } from "next";
import { JoinPage } from "@/components/join/join-page";

export const metadata: Metadata = {
  title: "Join a team — SL",
};

/**
 * UX-012: an invite link routes straight into the join flow. The code is a
 * path segment rather than a query parameter so the URL survives being pasted
 * anywhere, and so a logged-out visitor's own pathname IS the destination
 * Phase 4's auth screen returns them to — no `?next=` needed.
 */
export default async function JoinRoute({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  return <JoinPage code={decodeURIComponent(code)} />;
}

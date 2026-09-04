import type { Metadata } from "next";
import { AppGate } from "@/components/app-gate";

export const metadata: Metadata = {
  title: "Dashboard — SL",
};

export default function Home() {
  return <AppGate />;
}

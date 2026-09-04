import type { Metadata } from "next";
import { DashboardPage } from "@/components/dashboard-page";

export const metadata: Metadata = {
  title: "Dashboard — SL",
};

export default function Home() {
  return <DashboardPage />;
}

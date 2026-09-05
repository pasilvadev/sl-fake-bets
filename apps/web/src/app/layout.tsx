import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { getSessionUser } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SL Fake Bets",
  description: "Bet fake coins with your friends on anything.",
};

/**
 * Reading the session here (roadmap Phase 4) is what lets the first client
 * render already know who the visitor is — no logged-out flash, no hydration
 * mismatch (UX-011). It also makes every route dynamic, which is correct:
 * every page in this app is per-user by definition.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const initialUser = await getSessionUser();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppProviders initialUser={initialUser}>{children}</AppProviders>
      </body>
    </html>
  );
}

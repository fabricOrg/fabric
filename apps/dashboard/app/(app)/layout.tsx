import { Button } from "@app/ui/components/ui/button";
import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu, CommandMenuTrigger } from "@/components/command-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatMoney } from "@/lib/money";
import { requireDashboardSession } from "@/lib/server/auth";
import { getWalletSnapshot } from "@/lib/server/dashboard-data";

/**
 * Authenticated dashboard shell: the sidebar (corrected IA) + a topbar that keeps balance VISIBILITY
 * one click away everywhere (visibility ≠ wallet management, which lives in its own section).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireDashboardSession();
  const primaryBalance = (await getWalletSnapshot()).balances[0]?.balance;
  const isSandbox = session.plan === "sandbox";
  return (
    <SidebarProvider>
      <AppSidebar role={session.role} />
      <SidebarInset>
        {isSandbox ? (
          <div className="flex h-8 shrink-0 items-center justify-center gap-2 bg-amber-500/15 px-4 text-xs font-medium text-amber-700 dark:text-amber-400">
            <span className="rounded-sm bg-amber-500/25 px-1.5 py-0.5 font-semibold tracking-wide">
              SANDBOX
            </span>
            Messages route to the test provider and never reach a real phone.
            Request go-live to send real traffic.
          </div>
        ) : null}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <CommandMenuTrigger />
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="font-mono tabular-nums"
            >
              <Link href="/wallet">
                <Wallet data-icon="inline-start" />
                {primaryBalance ? formatMoney(primaryBalance) : "Wallet"}
              </Link>
            </Button>
            <ThemeToggle />
            <form action="/auth/logout" method="post">
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                title="Sign out"
              >
                <LogOut />
                <span className="sr-only">Sign out</span>
              </Button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
      <CommandMenu />
    </SidebarProvider>
  );
}

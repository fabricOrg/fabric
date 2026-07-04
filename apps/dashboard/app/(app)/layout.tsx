import { Button } from "@app/ui/components/ui/button";
import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatMoney } from "@/lib/money";
import { requireDashboardSession } from "@/lib/server/auth";
import { getWalletSnapshot } from "@/lib/server/dashboard-data";

/**
 * Authenticated dashboard shell: the sidebar (corrected IA) + a topbar that keeps balance VISIBILITY
 * one click away everywhere (visibility ≠ wallet management, which lives in its own section).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireDashboardSession();
  const primaryBalance = (await getWalletSnapshot()).balances[0]?.balance;
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
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
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

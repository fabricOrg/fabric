import { AppShell } from "@app/ui/components/ui/app-shell";
import { Button } from "@app/ui/components/ui/button";
import { UserMenu } from "@app/ui/components/ui/user-menu";
import { Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu, CommandMenuTrigger } from "@/components/command-menu";
import { DeliveryModeToggle } from "@/components/delivery-mode-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { VirtualPhoneNotifier } from "@/components/virtual-phone-notifier";
import { formatMoney } from "@/lib/money";
import { requireDashboardWorkspaceContext } from "@/lib/server/auth";
import { getWalletSnapshot } from "@/lib/server/dashboard-data";

/**
 * Authenticated dashboard shell: the sidebar (corrected IA) + a topbar that keeps balance VISIBILITY
 * one click away everywhere (visibility ≠ wallet management, which lives in its own section).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, session } = await requireDashboardWorkspaceContext();
  const primaryBalance = (await getWalletSnapshot()).balances[0]?.balance;
  const isSandbox = session.plan === "sandbox";
  return (
    <AppShell
      sidebar={
        <AppSidebar
          role={session.role}
          permissions={session.permissions}
          email={session.email}
          name={session.name}
          activeTenantId={session.orgId}
          workspaces={user.memberships.map((membership) => ({
            tenantId: membership.tenantId,
            name: membership.workspaceName,
            role: membership.role,
          }))}
        />
      }
      banner={
        isSandbox ? (
          <div className="flex h-8 shrink-0 items-center justify-center gap-2 bg-amber-500/15 px-4 text-xs font-medium text-amber-700 dark:text-amber-400">
            <span className="rounded-sm bg-amber-500/25 px-1.5 py-0.5 font-semibold tracking-wide">
              SANDBOX
            </span>
            Messages are delivered to your virtual phone and never reach a
            carrier.
            <Link
              href="/virtual-phone"
              className="font-semibold underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-300"
            >
              Open virtual phone
            </Link>
            <Link
              href="/go-live"
              className="font-semibold underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-300"
            >
              Request go-live
            </Link>
          </div>
        ) : null
      }
      headerContext={<CommandMenuTrigger />}
      breadcrumbs={<AppBreadcrumbs />}
      headerActions={
        <>
          <DeliveryModeToggle />
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
          <VirtualPhoneNotifier />
          <ThemeToggle />
          <UserMenu
            email={session.email}
            name={session.name}
            role={session.role}
          />
        </>
      }
    >
      {children}
      <CommandMenu />
    </AppShell>
  );
}

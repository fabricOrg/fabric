import { AppShell } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { UserMenu } from "@app/ui/components/ui/user-menu";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireDeveloperSession } from "@/lib/server/auth";

/**
 * Dev-portal shell: sidebar (API keys · reference · webhooks · logs) + a topbar carrying the
 * environment context — a "DEV" pill (this is the developer surface, not the product dashboard) and
 * a "Back to dashboard" link (same realm, sibling app — intended long-term; today gated behind a
 * coarse WorkOS allowlist since the underlying data is still mock, see lib/server/auth.ts).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireDeveloperSession();
  return (
    <AppShell
      sidebar={
        <AppSidebar
          role={session.role}
          email={session.email}
          name={session.name}
        />
      }
      headerContext={
        <Badge
          variant="outline"
          className="font-mono text-[0.65rem] tracking-wide"
        >
          DEV
        </Badge>
      }
      breadcrumbs={<AppBreadcrumbs />}
      headerActions={
        <>
          <Button asChild variant="outline" size="sm">
            <a href={process.env.DASHBOARD_BASE_URL ?? "http://localhost:3100"}>
              Back to dashboard
              <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
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
    </AppShell>
  );
}

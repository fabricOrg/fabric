import { AppShell } from "@app/ui/components/ui/app-shell";
import { UserMenu } from "@app/ui/components/ui/user-menu";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppSidebar } from "@/components/app-sidebar";
import { BreadcrumbTitleProvider } from "@/components/breadcrumb-title";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { readImpersonationClaim, requireAdminSession } from "@/lib/server/auth";

/**
 * Fabric Admin shell (staff realm). Requires a real WorkOS-authenticated staff session — the
 * never-silent impersonation banner sits ABOVE everything so an operator can never forget they're
 * acting as a tenant. Topbar carries the staff-realm marker.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();
  const impersonation = await readImpersonationClaim();
  return (
    <BreadcrumbTitleProvider>
      <AppShell
        sidebar={
          <AppSidebar
            role={session.role}
            email={session.email}
            name={session.name}
          />
        }
        banner={
          <ImpersonationBanner
            claim={
              impersonation
                ? {
                    tenantLabel:
                      impersonation.targetLabel ?? impersonation.targetTenantId,
                    endsAt: impersonation.expiresAt,
                  }
                : null
            }
          />
        }
        breadcrumbs={<AppBreadcrumbs />}
        headerContext={
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span>Staff console</span>
          </div>
        }
        headerActions={
          <>
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
    </BreadcrumbTitleProvider>
  );
}

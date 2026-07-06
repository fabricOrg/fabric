import { Button } from "@app/ui/components/ui/button";
import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { LogOut, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireAdminSession } from "@/lib/server/auth";

/**
 * Fabric Admin shell (staff realm). Requires a real WorkOS-authenticated staff session — the
 * never-silent impersonation banner sits ABOVE everything so an operator can never forget they're
 * acting as a tenant. Topbar carries the staff-realm marker.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();
  return (
    <SidebarProvider>
      <AppSidebar role={session.role} />
      <SidebarInset>
        <ImpersonationBanner />
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span>Staff console</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
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
    </SidebarProvider>
  );
}

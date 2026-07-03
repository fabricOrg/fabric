import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Fabric Admin shell (staff realm). The never-silent impersonation banner sits ABOVE everything so
 * an operator can never forget they're acting as a tenant. Topbar carries the staff-realm marker.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
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
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

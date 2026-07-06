import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { ArrowUpRight, LogOut } from "lucide-react";
import type { ReactNode } from "react";
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
    <SidebarProvider>
      <AppSidebar role={session.role} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <Badge
            variant="outline"
            className="font-mono text-[0.65rem] tracking-wide"
          >
            DEV
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="http://localhost:3100">
                Back to dashboard
                <ArrowUpRight data-icon="inline-end" />
              </a>
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
    </SidebarProvider>
  );
}

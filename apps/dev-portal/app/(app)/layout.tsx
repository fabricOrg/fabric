import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Dev-portal shell: sidebar (API keys · reference · webhooks · logs) + a topbar carrying the
 * environment context — a "DEV" pill (this is the developer surface, not the product dashboard) and
 * a "Back to dashboard" link (same realm, sibling app). Auth is mocked until PI-3.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
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
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

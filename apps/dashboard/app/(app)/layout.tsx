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

/**
 * Authenticated dashboard shell: the sidebar (corrected IA) + a topbar that keeps balance VISIBILITY
 * one click away everywhere (visibility ≠ wallet management, which lives in its own section).
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
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="font-mono tabular-nums"
            >
              <Link href="/wallet">
                <Wallet data-icon="inline-start" />
                GHS 1,204.03
              </Link>
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

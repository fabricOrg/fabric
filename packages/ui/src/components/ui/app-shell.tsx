import { Separator } from "@app/ui/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@app/ui/components/ui/sidebar";
import { cn } from "@app/ui/lib/utils";
import type { ReactNode } from "react";

export function AppShell({
  sidebar,
  banner,
  headerContext,
  headerActions,
  breadcrumbs,
  children,
}: {
  sidebar: ReactNode;
  banner?: ReactNode;
  headerContext?: ReactNode;
  headerActions?: ReactNode;
  breadcrumbs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      {sidebar}
      <SidebarInset>
        {banner}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-[orientation=vertical]:h-4"
          />
          <div className="flex min-w-0 items-center gap-2">{headerContext}</div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {headerActions}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-7">
          {breadcrumbs ? (
            <div className="mx-auto mb-4 w-full max-w-6xl">{breadcrumbs}</div>
          ) : null}
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function PageContainer({
  size = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "narrow" | "default" | "wide" | "full";
}) {
  return (
    <div
      data-slot="page-container"
      data-size={size}
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-6",
        size === "narrow" && "max-w-3xl",
        size === "default" && "max-w-6xl",
        size === "wide" && "max-w-[90rem]",
        size === "full" && "max-w-none",
        className,
      )}
      {...props}
    />
  );
}

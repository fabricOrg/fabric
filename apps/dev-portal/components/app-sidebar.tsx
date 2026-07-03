"use client";

import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@app/ui/components/ui/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/nav";

/** Fabric wordmark + a DEV pill — this is the developer surface, visually distinct from the product. */
function FabricDevMark() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div
        className="flex size-8 flex-col items-center justify-center gap-[3px] rounded-md bg-primary"
        aria-hidden="true"
      >
        <span className="h-0.5 w-3.5 rounded-full bg-primary-foreground" />
        <span className="h-0.5 w-3.5 rounded-full bg-primary-foreground" />
        <span className="h-0.5 w-3.5 rounded-full bg-primary-foreground" />
      </div>
      <span className="font-display text-lg font-semibold tracking-tight">
        Fabric
      </span>
      <Badge variant="secondary" className="font-mono text-[0.65rem]">
        DEV
      </Badge>
    </div>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <FabricDevMark />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>KM</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">Kofi Mensah</span>
            <span className="truncate text-xs text-muted-foreground">
              KwikGH · Developer
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

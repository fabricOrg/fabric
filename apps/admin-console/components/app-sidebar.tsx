"use client";

import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@app/ui/components/ui/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "@/lib/nav";

function FabricAdminMark() {
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
      <Badge variant="secondary" className="ml-auto text-[10px] tracking-wide">
        ADMIN
      </Badge>
    </div>
  );
}

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <FabricAdminMark />
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group, i) => (
          <SidebarGroup key={group.label ?? `group-${i}`}>
            {group.label ? (
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
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
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>{role.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">Staff member</span>
            <span className="truncate text-xs text-muted-foreground">
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

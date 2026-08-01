"use client";

import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { ProductMark } from "@app/ui/components/ui/product-mark";
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
import { activeNavHref } from "@/lib/nav-active";

export function AppSidebar({
  role,
  email,
  name,
}: {
  role: string;
  email?: string;
  name?: string;
}) {
  const pathname = usePathname();
  const activeHref = activeNavHref(navGroups, pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProductMark product="Admin" />
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
                  const active = item.href === activeHref;
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
        <Link
          href="/profile"
          className="flex items-center gap-2 rounded-md p-2 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          aria-label="Open profile"
        >
          <Avatar className="size-8">
            <AvatarFallback>
              {(name ?? email)?.charAt(0).toUpperCase() ??
                role.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">
              {name ?? email ?? "Staff member"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {name && email
                ? email
                : role.charAt(0).toUpperCase() + role.slice(1)}
            </span>
          </div>
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

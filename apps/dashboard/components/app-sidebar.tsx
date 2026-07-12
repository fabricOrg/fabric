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

/** The Fabric wordmark — the brand "F" mark (mirrors app/icon.svg, tokenised for white-label) +
 *  the display-face name. */
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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProductMark product="Dashboard" showBadge={false} />
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
                        tooltip={
                          item.preview
                            ? `${item.title} — preview (mock data)`
                            : item.title
                        }
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.title}</span>
                          {item.preview ? (
                            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground group-data-[collapsible=icon]:hidden">
                              Preview
                            </span>
                          ) : null}
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
              {(name ?? email)?.charAt(0).toUpperCase() ?? "F"}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">
              {name ?? email ?? "Fabric user"}
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

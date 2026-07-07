"use client";

import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
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

/** The Fabric wordmark — a woven-threads mark (three warp threads) + the display-face name. */
function FabricMark() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5">
      <div
        className="flex size-10 flex-col items-center justify-center gap-1 rounded-lg bg-primary"
        aria-hidden="true"
      >
        <span className="h-0.5 w-5 rounded-full bg-primary-foreground" />
        <span className="h-0.5 w-5 rounded-full bg-primary-foreground" />
        <span className="h-0.5 w-5 rounded-full bg-primary-foreground" />
      </div>
      <span className="font-display text-2xl font-semibold tracking-tight">
        Fabric
      </span>
    </div>
  );
}

export function AppSidebar({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <FabricMark />
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
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar className="size-8">
            <AvatarFallback>F</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-medium">
              Customer workspace
            </span>
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

"use client";

import { RouteBreadcrumbs } from "@app/ui/components/ui/route-breadcrumbs";
import { usePathname } from "next/navigation";
import { navGroups } from "@/lib/nav";

const routes = [
  ...navGroups.flatMap((group) =>
    group.items.map(({ href, title }) => ({ href, label: title })),
  ),
  { href: "/profile", label: "Profile" },
];

export function AppBreadcrumbs() {
  return (
    <RouteBreadcrumbs
      appLabel="Admin"
      pathname={usePathname()}
      routes={routes}
    />
  );
}

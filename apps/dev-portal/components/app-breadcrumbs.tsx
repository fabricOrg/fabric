"use client";

import { RouteBreadcrumbs } from "@app/ui/components/ui/route-breadcrumbs";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/nav";

const routes = [
  ...navItems.map(({ href, title }) => ({ href, label: title })),
  { href: "/profile", label: "Profile" },
];

export function AppBreadcrumbs() {
  return (
    <RouteBreadcrumbs
      appLabel="Developer"
      pathname={usePathname()}
      routes={routes}
    />
  );
}

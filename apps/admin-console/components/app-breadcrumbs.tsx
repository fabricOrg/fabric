"use client";

import { RouteBreadcrumbs } from "@app/ui/components/ui/route-breadcrumbs";
import { usePathname } from "next/navigation";
import { useBreadcrumbTitle } from "@/components/breadcrumb-title";
import { navGroups } from "@/lib/nav";

const routes = [
  ...navGroups.flatMap((group) =>
    group.items.map(({ href, title }) => ({ href, label: title })),
  ),
  { href: "/profile", label: "Profile" },
];

export function AppBreadcrumbs() {
  const { title } = useBreadcrumbTitle();
  return (
    <RouteBreadcrumbs
      appLabel="Admin"
      pathname={usePathname()}
      routes={routes}
      current={title ?? undefined}
      // `books` groups /pricing/books/new and /pricing/books/[id]; there is no page at
      // /pricing/books itself, and the list lives on /pricing.
      unlinkedSegments={["books"]}
    />
  );
}

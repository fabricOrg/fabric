import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@app/ui/components/ui/breadcrumb";

export interface BreadcrumbRoute {
  href: string;
  label: string;
}

function humanize(segment: string) {
  return decodeURIComponent(segment)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function RouteBreadcrumbs({
  appLabel,
  pathname,
  routes,
  current: currentOverride,
}: {
  appLabel: string;
  pathname: string;
  routes: readonly BreadcrumbRoute[];
  /** Explicit leaf label — for dynamic routes (e.g. /tenants/[slug]) where the URL segment isn't a
   *  human-readable name. Falls back to an exact route match, then a humanized last segment. */
  current?: string;
}) {
  const exact = routes.find((route) => route.href === pathname);
  const parent = [...routes]
    .filter(
      (route) => route.href !== "/" && pathname.startsWith(`${route.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  const current =
    currentOverride ??
    exact?.label ??
    humanize(pathname.split("/").filter(Boolean).at(-1) ?? "Overview");

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">{appLabel}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {parent ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink href={parent.href}>{parent.label}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        ) : null}
        <BreadcrumbItem>
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

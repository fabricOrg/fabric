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
  const decoded = decodeURIComponent(segment);
  // A key, slug or id is a NAME, not prose: `order.shipped` must stay itself rather than becoming
  // "Order.Shipped", and a uuid must not be title-cased. Only word-ish segments get humanized.
  if (/[.@]|^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(decoded)) return decoded;
  return decoded
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function RouteBreadcrumbs({
  appLabel,
  pathname,
  routes,
  current: currentOverride,
  unlinkedPaths = [],
}: {
  appLabel: string;
  pathname: string;
  routes: readonly BreadcrumbRoute[];
  /** Explicit leaf label — for dynamic routes (e.g. /tenants/[slug]) where the URL segment isn't a
   *  human-readable name. Falls back to an exact route match, then a humanized last segment. */
  current?: string;
  /**
   * Path segments that GROUP routes without being one themselves — e.g. `/pricing/books/new` where
   * `books` is a folder with no page. They still appear in the trail, as plain text rather than a
   * link, because a linked crumb that 404s is worse than no link at all. Declared by the app because
   * only it knows its route table: linking solely to declared nav routes would un-link the dynamic
   * segments this trail exists to show (`/message-definitions/order.shipped`).
   */
  unlinkedPaths?: readonly string[];
}) {
  const exact = routes.find((route) => route.href === pathname);
  const parent = [...routes]
    .filter(
      (route) => route.href !== "/" && pathname.startsWith(`${route.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  const segments = pathname.split("/").filter(Boolean);
  const current =
    currentOverride ?? exact?.label ?? humanize(segments.at(-1) ?? "Overview");

  // Linked crumbs for the segments BETWEEN the nav route and the leaf, so a nested page carries its
  // own trail (…/message-definitions/order.shipped/edit shows the definition, linked). This is what
  // replaces the separate "← back" affordance those pages used to render above their title: two
  // controls, one job, and only one of them told you where you actually were.
  const parentDepth = parent
    ? parent.href.split("/").filter(Boolean).length
    : 0;
  const middle =
    parent && !exact
      ? segments.slice(parentDepth, -1).map((segment, index) => ({
          label: humanize(segment),
          href: `/${segments.slice(0, parentDepth + index + 1).join("/")}`,
          linkable: !unlinkedPaths.includes(
            `/${segments.slice(0, parentDepth + index + 1).join("/")}`,
          ),
        }))
      : [];

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
        {middle.map((crumb) => (
          <BreadcrumbItem key={crumb.href}>
            {crumb.linkable ? (
              <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
            ) : (
              // Not BreadcrumbPage: that hardcodes aria-current="page", and the leaf below already
              // claims it — two current pages in one trail. A non-routable ancestor is a disabled
              // link, not the current one.
              <span
                role="link"
                aria-disabled="true"
                className="text-muted-foreground"
              >
                {crumb.label}
              </span>
            )}
            <BreadcrumbSeparator />
          </BreadcrumbItem>
        ))}
        <BreadcrumbItem>
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

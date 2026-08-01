/**
 * Which nav item owns the current path: the MOST SPECIFIC match, never every ancestor.
 *
 * A plain `startsWith` selected `/pricing` and `/pricing/offers` simultaneously. Matching on a
 * segment boundary also stops `/pricing` from claiming `/pricing-experiments`.
 *
 * Pure and separate from the component so the rule is testable without rendering a sidebar.
 */
export function activeNavHref(
  groups: readonly { readonly items: readonly { readonly href: string }[] }[],
  pathname: string,
): string {
  return groups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`),
    )
    .reduce(
      (longest, href) => (href.length > longest.length ? href : longest),
      "",
    );
}

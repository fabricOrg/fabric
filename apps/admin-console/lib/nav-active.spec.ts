import { describe, expect, it } from "vitest";
import { navGroups } from "./nav";
import { activeNavHref } from "./nav-active";

describe("sidebar active route", () => {
  it("selects the most specific item, not every ancestor", () => {
    // The regression: a plain startsWith lit up "Pricing" AND "Prepaid packages" together.
    expect(activeNavHref(navGroups, "/pricing/offers")).toBe("/pricing/offers");
    expect(activeNavHref(navGroups, "/pricing")).toBe("/pricing");
  });

  it("keeps a nested route under its own item", () => {
    expect(activeNavHref(navGroups, "/pricing/offers/anything")).toBe(
      "/pricing/offers",
    );
  });

  it("matches on a segment boundary, so a sibling prefix cannot steal it", () => {
    expect(activeNavHref(navGroups, "/pricing-experiments")).toBe("");
  });

  it("only matches the dashboard root exactly", () => {
    expect(activeNavHref([{ items: [{ href: "/" }] }], "/")).toBe("/");
    expect(activeNavHref([{ items: [{ href: "/" }] }], "/staff")).toBe("");
  });
});

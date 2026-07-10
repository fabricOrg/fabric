import { describe, expect, it } from "vitest";
import { PLANS, schema, slugify } from "./create-tenant-dialog.schema.js";

/**
 * Create-tenant form schema — unit spec (finding A2). The dialog gates provisioning (a real
 * external write: WorkOS org + invite) on this schema, so its validation is a correctness surface.
 */

describe("slugify", () => {
  it("lower-cases, collapses non-alphanumerics to single dashes, trims edges", () => {
    expect(slugify("KwikGH Ltd.")).toBe("kwikgh-ltd");
    expect(slugify("  Acme  &  Co  ")).toBe("acme-co");
    expect(slugify("already-good")).toBe("already-good");
  });
});

describe("provision schema", () => {
  const valid = {
    name: "KwikGH",
    slug: "kwikgh",
    region: "gh-accra",
    plan: "growth" as const,
    adminEmail: "ops@kwikgh.com",
  };

  it("accepts a well-formed tenant", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("rejects a short name", () => {
    expect(schema.safeParse({ ...valid, name: "K" }).success).toBe(false);
  });

  it("rejects an upper-case or space-bearing slug", () => {
    expect(schema.safeParse({ ...valid, slug: "KwikGH" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, slug: "kwik gh" }).success).toBe(false);
  });

  it("rejects a bad email", () => {
    expect(schema.safeParse({ ...valid, adminEmail: "nope" }).success).toBe(
      false,
    );
  });

  it("rejects a plan outside the tiers", () => {
    expect(schema.safeParse({ ...valid, plan: "enterprise" }).success).toBe(
      false,
    );
    expect(PLANS).toEqual(["free", "growth", "scale"]);
  });
});

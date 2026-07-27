import { describe, expect, it } from "vitest";
import {
  isPublicApiPath,
  parseAllowedOrigins,
  publicCorsOrigin,
  varyWithOrigin,
} from "./public-cors.js";

/**
 * This predicate decides which responses become readable by any page on the internet, so the
 * negative cases matter more than the positive one: a false positive here would expose the
 * authenticated data plane, not merely mis-style a page.
 */
describe("isPublicApiPath", () => {
  it("matches the published pricing snapshot", () => {
    expect(isPublicApiPath("/v1/public/pricing")).toBe(true);
  });

  it("ignores the query string", () => {
    expect(isPublicApiPath("/v1/public/pricing?currency=GHS")).toBe(true);
  });

  it("matches an absolute-form request target", () => {
    expect(isPublicApiPath("https://api.example.com/v1/public/pricing")).toBe(
      true,
    );
  });

  it("does NOT match the authenticated data plane", () => {
    expect(isPublicApiPath("/v1/messages")).toBe(false);
    expect(isPublicApiPath("/v1/wallet")).toBe(false);
  });

  it("does NOT match the internal BFF surface", () => {
    expect(isPublicApiPath("/internal/admin/staff")).toBe(false);
  });

  it("does NOT match a route that merely shares the prefix's letters", () => {
    // The trailing slash in the prefix is what stops this; without it, a future /v1/publicity
    // route would silently inherit public CORS.
    expect(isPublicApiPath("/v1/publicity")).toBe(false);
    expect(isPublicApiPath("/v1/public")).toBe(false);
  });

  it("does not let a query string smuggle the prefix in", () => {
    expect(isPublicApiPath("/v1/messages?next=/v1/public/pricing")).toBe(false);
  });

  it("treats an unparseable target as not public", () => {
    expect(isPublicApiPath("")).toBe(false);
    expect(isPublicApiPath("not a url")).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  it("fails closed when unset or empty", () => {
    // A missing config must show up as "the pricing section is empty", never as a
    // world-readable endpoint.
    expect(parseAllowedOrigins(undefined).size).toBe(0);
    expect(parseAllowedOrigins("").size).toBe(0);
    expect(parseAllowedOrigins("  ,  ").size).toBe(0);
  });

  it("normalises a trailing slash or stray path to a bare origin", () => {
    // A browser's Origin header carries neither, so an unnormalised config value would never match.
    const allowed = parseAllowedOrigins(
      "https://fabric.example/, https://www.fabric.example/pricing",
    );
    expect([...allowed]).toEqual([
      "https://fabric.example",
      "https://www.fabric.example",
    ]);
  });

  it("drops entries that aren't valid absolute origins", () => {
    expect([...parseAllowedOrigins("not-a-url, https://ok.example")]).toEqual([
      "https://ok.example",
    ]);
  });
});

describe("publicCorsOrigin", () => {
  const allowed = parseAllowedOrigins(
    "https://fabric.example,https://preview.fabric.example",
  );

  it("echoes an allowed origin", () => {
    expect(publicCorsOrigin("https://fabric.example", allowed)).toBe(
      "https://fabric.example",
    );
  });

  it("refuses an origin that isn't configured", () => {
    expect(publicCorsOrigin("https://evil.example", allowed)).toBeNull();
  });

  it("refuses a look-alike suffix", () => {
    // Exact-set membership, never substring matching — "fabric.example.evil.com" must not pass.
    expect(publicCorsOrigin("https://fabric.example.evil.com", allowed)).toBe(
      null,
    );
  });

  it("distinguishes scheme and port", () => {
    expect(publicCorsOrigin("http://fabric.example", allowed)).toBeNull();
    expect(publicCorsOrigin("https://fabric.example:8443", allowed)).toBeNull();
  });

  it("sends no header when there is no Origin (curl, server-to-server)", () => {
    // CORS constrains browsers only; these callers read the endpoint exactly as before.
    expect(publicCorsOrigin(undefined, allowed)).toBeNull();
  });
});

describe("varyWithOrigin", () => {
  it("appends to an existing Vary rather than replacing it", () => {
    // Replacing would drop Accept-Encoding and let a cache serve brotli to a client that never
    // asked for it.
    expect(varyWithOrigin("Accept-Encoding")).toBe("Accept-Encoding, Origin");
  });

  it("adds Origin when there is no existing Vary", () => {
    expect(varyWithOrigin(undefined)).toBe("Origin");
    expect(varyWithOrigin("")).toBe("Origin");
  });

  it("does not duplicate Origin, whatever its case", () => {
    expect(varyWithOrigin("origin")).toBe("origin");
    expect(varyWithOrigin("Accept-Encoding, Origin")).toBe(
      "Accept-Encoding, Origin",
    );
  });
});

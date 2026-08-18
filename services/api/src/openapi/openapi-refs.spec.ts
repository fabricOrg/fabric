import { describe, expect, it } from "vitest";
import { assertRefsResolve, UnresolvedRefError } from "./openapi-refs.js";

/**
 * The check that was missing. `openapi:check` byte-compares the committed artifact against a fresh
 * build, so a document that is CONSISTENTLY broken passes it forever — which is how 175 pointers in
 * the published customer artifact came to resolve to nothing, the money field on `GET /v1/wallet`
 * among them.
 */
describe("assertRefsResolve", () => {
  it("accepts a document whose refs resolve", () => {
    expect(() =>
      assertRefsResolve({
        components: { schemas: { Wallet: { type: "object" } } },
        paths: {
          "/v1/wallet": {
            get: { schema: { $ref: "#/components/schemas/Wallet" } },
          },
        },
      }),
    ).not.toThrow();
  });

  it("rejects the exact shape zod produced — a local $defs addressed from the root", () => {
    // `components.schemas.Wallet.$defs.__schema0` exists; `#/$defs/__schema0` does not.
    expect(() =>
      assertRefsResolve({
        components: {
          schemas: {
            Wallet: {
              properties: { balance: { $ref: "#/$defs/__schema0" } },
              $defs: { __schema0: { type: "string" } },
            },
          },
        },
      }),
    ).toThrow(UnresolvedRefError);
  });

  it("accepts that same document once the pointer addresses where the def really lives", () => {
    expect(() =>
      assertRefsResolve({
        components: {
          schemas: {
            Wallet: {
              properties: {
                balance: {
                  $ref: "#/components/schemas/Wallet/$defs/__schema0",
                },
              },
              $defs: { __schema0: { type: "string" } },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("names every dangling pointer, so the fix does not need a bisect", () => {
    try {
      assertRefsResolve({
        a: { $ref: "#/nope" },
        b: { $ref: "#/also/missing" },
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("#/nope");
      expect(String(error)).toContain("#/also/missing");
      expect(String(error)).toContain("2 $ref");
    }
  });

  it("decodes JSON Pointer escapes rather than reporting a false dangle", () => {
    // `~1` is `/`, so this addresses the path key "/v1/wallet" and must RESOLVE.
    expect(() =>
      assertRefsResolve({
        paths: { "/v1/wallet": { get: {} } },
        ref: { $ref: "#/paths/~1v1~1wallet/get" },
      }),
    ).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { ROUTE_BINDINGS } from "./route-bindings.js";

/**
 * A request contract must describe a BODY — an object, or a union of objects.
 *
 * `PATCH /internal/tenants/:tenantId/messaging-settings` named the bare `deliveryMode` enum, so the
 * document published its body as the string "virtual" while every caller sent
 * `{ delivery_mode: "virtual" }`. Nothing caught it: `assertCoverage` proves a route HAS a binding,
 * not that the binding describes a body a handler could read; `openapi:check` proves the artifact
 * matches the bindings, which it faithfully did; and `contracts:probe` is GET-only by construction,
 * so no request body is ever exercised against a running API.
 *
 * It stayed invisible until request validation went strict and rejected every call at `<root>`. This
 * turns the one-off sweep that found it into something that stays done.
 */

/** zod v4 keeps the node kind here; `openapi-schema.ts` reads the same field for its overrides. */
function kindOf(schema: ZodType): string {
  return (schema as unknown as { _zod: { def: { type: string } } })._zod.def
    .type;
}

function describesABody(schema: ZodType): boolean {
  const kind = kindOf(schema);
  if (kind === "object") return true;
  // A discriminated union of objects is still a body — each branch has to be one.
  if (kind === "union") {
    const options = (
      schema as unknown as { _zod: { def: { options?: readonly ZodType[] } } }
    )._zod.def.options;
    if (!options || options.length === 0) return false;
    return options.every(describesABody);
  }
  return false;
}

const BODY_METHODS = ["POST", "PUT", "PATCH"];

describe("every request contract describes a body", () => {
  const withRequest = Object.entries(ROUTE_BINDINGS).filter(
    ([, binding]) => binding.request,
  );

  it("covers the routes it claims to — the guard must not pass by checking nothing", () => {
    expect(withRequest.length).toBeGreaterThan(50);
  });

  for (const [route, binding] of withRequest) {
    it(route, () => {
      const method = route.split(" ")[0] ?? "";
      // A GET with a request body would be its own defect; this rule is about the ones that carry one.
      if (!BODY_METHODS.includes(method)) return;
      const request = binding.request as ZodType;
      expect(
        describesABody(request),
        `${route} publishes its request body as "${kindOf(request)}". A caller sends an object, so ` +
          "the schema must be an object (or a union of objects) — otherwise the document describes " +
          "a body nobody sends and strict validation rejects every call.",
      ).toBe(true);
    });
  }
});

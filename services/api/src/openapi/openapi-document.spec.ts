import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BindingCoverageError,
  buildOpenApiDocument,
} from "./openapi-document.js";
import type { RouteBindings } from "./route-binding.types.js";
import type { DiscoveredRoute } from "./route-table.js";

/**
 * These tests exist because `assertCoverage` is the only thing standing between this repo and the
 * failure it was built to prevent — a new controller shipping undocumented. An assertion nobody
 * tests is an assertion that can silently stop asserting: `assert-drift.mjs` swallowed a generate
 * failure and reported "no drift" unconditionally for weeks, and that is the same shape.
 *
 * So the first two cases prove the gate FAILS. A test that only proves the happy path would still
 * pass if the throw were deleted.
 */

/**
 * `noUncheckedIndexedAccess` is on, so every hop into the emitted document is possibly-undefined.
 * These helpers throw on a miss rather than asserting non-null: a missing key means the generator
 * emitted the wrong shape, and that should fail loudly here rather than as a confusing later
 * assertion on `undefined`.
 */
function operation(
  doc: Record<string, unknown>,
  path: string,
  method: string,
): Record<string, unknown> {
  const paths = doc.paths as
    | Record<string, Record<string, unknown>>
    | undefined;
  const byMethod = paths?.[path];
  if (!byMethod) throw new Error(`no path ${path} in document`);
  const op = byMethod[method];
  if (!op) throw new Error(`no ${method} on ${path}`);
  return op as Record<string, unknown>;
}

/** The `required` array of a request body or a 200 response schema. */
function requiredOf(
  doc: Record<string, unknown>,
  path: string,
  method: string,
  which: "requestBody" | "response200",
): string[] {
  const op = operation(doc, path, method);
  const holder =
    which === "requestBody"
      ? (op.requestBody as {
          content?: Record<string, { schema?: { required?: string[] } }>;
        })
      : (
          op.responses as Record<
            string,
            { content?: Record<string, { schema?: { required?: string[] } }> }
          >
        )["200"];
  const schema = holder?.content?.["application/json"]?.schema;
  if (!schema)
    throw new Error(`no json schema for ${which} on ${method} ${path}`);
  return schema.required ?? [];
}

const OPTIONS = {
  include: ["public"] as const,
  serverUrl: "https://example.test",
  title: "T",
  description: "D",
  version: "1.0.0",
};

function route(method: string, path: string): DiscoveredRoute {
  return { method, path, controller: "C", handler: "h" };
}

const binding = {
  summary: "s",
  tags: ["T"] as const,
  visibility: "public" as const,
  security: ["secretKey"] as const,
};

describe("assertCoverage", () => {
  it("REFUSES to emit when a route has no binding", () => {
    expect(() =>
      buildOpenApiDocument([route("GET", "/v1/thing")], {}, { ...OPTIONS }),
    ).toThrow(BindingCoverageError);
  });

  it("names the unbound route and its controller, so the fix is obvious", () => {
    try {
      buildOpenApiDocument(
        [
          {
            method: "POST",
            path: "/v1/new",
            controller: "NewCtl",
            handler: "go",
          },
        ],
        {},
        { ...OPTIONS },
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("POST /v1/new");
      expect(String(error)).toContain("NewCtl.go");
    }
  });

  it("REFUSES to emit when a binding names a route that no longer exists", () => {
    const stale: RouteBindings = { "GET /v1/removed": binding };
    expect(() => buildOpenApiDocument([], stale, { ...OPTIONS })).toThrow(
      /no longer exists/,
    );
  });

  it("emits when routes and bindings agree", () => {
    const doc = buildOpenApiDocument(
      [route("GET", "/v1/thing")],
      { "GET /v1/thing": binding },
      { ...OPTIONS },
    );
    expect(Object.keys(doc.paths as object)).toEqual(["/v1/thing"]);
  });
});

describe("visibility", () => {
  const routes = [
    route("GET", "/v1/public-thing"),
    route("GET", "/internal/secret"),
    route("POST", "/webhooks/provider"),
  ];
  const bindings: RouteBindings = {
    "GET /v1/public-thing": binding,
    "GET /internal/secret": { ...binding, visibility: "internal" },
    "POST /webhooks/provider": { ...binding, visibility: "webhook" },
  };

  it("keeps internal and webhook routes OUT of the public artifact", () => {
    const doc = buildOpenApiDocument(routes, bindings, { ...OPTIONS });
    const paths = Object.keys(doc.paths as object);
    expect(paths).toEqual(["/v1/public-thing"]);
    // Asserted as a whole-document check too: a leak could arrive via any key, not just `paths`.
    expect(JSON.stringify(doc)).not.toContain("/internal/secret");
  });

  it("includes everything in the full artifact", () => {
    const doc = buildOpenApiDocument(routes, bindings, {
      ...OPTIONS,
      include: ["public", "internal", "webhook"],
    });
    expect(Object.keys(doc.paths as object)).toHaveLength(3);
  });
});

describe("schema derivation", () => {
  it("uses the INPUT shape for requests and the OUTPUT shape for responses", () => {
    // A default makes the field optional going in and guaranteed coming out. Documenting one
    // direction with the other's schema tells callers to send what the API rejects, or to expect a
    // field that is never absent — the exact error a hand-written spec makes invisibly.
    const withDefault = z.object({ mode: z.string().default("live") });
    const doc = buildOpenApiDocument(
      [route("POST", "/v1/thing")],
      {
        "POST /v1/thing": {
          ...binding,
          request: withDefault,
          response: withDefault,
        },
      },
      { ...OPTIONS },
    );
    const req = requiredOf(doc, "/v1/thing", "post", "requestBody");
    const res = requiredOf(doc, "/v1/thing", "post", "response200");

    expect(req).not.toContain("mode"); // optional on the way in
    expect(res).toContain("mode"); // guaranteed on the way out
  });

  it("renders bigint money as an exact string, never a JSON number", () => {
    const doc = buildOpenApiDocument(
      [route("GET", "/v1/wallet")],
      {
        "GET /v1/wallet": {
          ...binding,
          response: z.object({ minor: z.bigint() }),
        },
      },
      { ...OPTIONS },
    );
    const schema = JSON.stringify(doc);
    expect(schema).toContain('"pattern":"^-?\\\\d+$"');
    // The whole point: a client generated from this must not parse money as a number.
    expect(schema).not.toContain('"minor":{"type":"integer"}');
  });
});

describe("document shape", () => {
  it("carries the configured server url rather than a hardcoded host", () => {
    const doc = buildOpenApiDocument(
      [route("GET", "/v1/thing")],
      { "GET /v1/thing": binding },
      { ...OPTIONS, serverUrl: "https://api.example.com" },
    );
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  it("converts Nest :params into OpenAPI {params} and marks them required", () => {
    const doc = buildOpenApiDocument(
      [route("GET", "/v1/thing/:id")],
      { "GET /v1/thing/:id": binding },
      { ...OPTIONS },
    );
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths)).toEqual(["/v1/thing/{id}"]);
    const op = operation(doc, "/v1/thing/{id}", "get") as {
      parameters?: { name: string; required: boolean }[];
    };
    expect(op.parameters?.[0]).toMatchObject({ name: "id", required: true });
  });
});

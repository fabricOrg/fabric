import { sendSmsRequest } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument } from "./openapi-document.js";
import type { DiscoveredRoute } from "./route-table.js";

/**
 * Split from `openapi-document.spec.ts` at the 400-line test guard. These cases are all about what
 * the emitted document PUBLISHES — the Models section and the credentials — rather than about the
 * coverage assertion, so they read better apart anyway.
 */

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

function operation(
  doc: Record<string, unknown>,
  path: string,
  method: string,
): Record<string, unknown> {
  const paths = doc.paths as Record<string, Record<string, unknown>>;
  const op = paths[path]?.[method];
  if (!op) throw new Error(`no ${method} on ${path}`);
  return op as Record<string, unknown>;
}

describe("components.schemas", () => {
  it("lifts a NAMED contract into components and references it", () => {
    // Everything used to be inlined, so the reference's Models section held only ErrorEnvelope —
    // the panel a QA engineer reads to learn the shapes was effectively empty.
    const doc = buildOpenApiDocument(
      [route("POST", "/v1/thing")],
      { "POST /v1/thing": { ...binding, request: sendSmsRequest } },
      { ...OPTIONS },
    );
    const components = (
      doc.components as {
        schemas: Record<string, unknown>;
      }
    ).schemas;
    expect(Object.keys(components)).toContain("SendSmsRequestInput");

    const op = operation(doc, "/v1/thing", "post") as {
      requestBody: { content: Record<string, { schema: { $ref?: string } }> };
    };
    expect(op.requestBody.content["application/json"]?.schema.$ref).toBe(
      "#/components/schemas/SendSmsRequestInput",
    );
  });

  it("leaves an ANONYMOUS schema inlined — it has no name a reader could look up", () => {
    const doc = buildOpenApiDocument(
      [route("POST", "/v1/anon")],
      {
        "POST /v1/anon": { ...binding, request: z.object({ a: z.string() }) },
      },
      { ...OPTIONS },
    );
    const op = operation(doc, "/v1/anon", "post") as {
      requestBody: {
        content: Record<string, { schema: Record<string, unknown> }>;
      };
    };
    const schema = op.requestBody.content["application/json"]?.schema;
    expect(schema?.$ref).toBeUndefined();
    expect(schema?.type).toBe("object");
  });

  it("keeps request and response renderings of one contract separate", () => {
    // io:"input" and io:"output" genuinely differ wherever a contract has a default or transform,
    // so collapsing both onto one component would publish one of them as a lie.
    const doc = buildOpenApiDocument(
      [route("POST", "/v1/both")],
      {
        "POST /v1/both": {
          ...binding,
          request: sendSmsRequest,
          response: sendSmsRequest,
        },
      },
      { ...OPTIONS },
    );
    const names = Object.keys(
      (doc.components as { schemas: Record<string, unknown> }).schemas,
    );
    expect(names).toContain("SendSmsRequestInput");
    expect(names).toContain("SendSmsRequest");
  });
});

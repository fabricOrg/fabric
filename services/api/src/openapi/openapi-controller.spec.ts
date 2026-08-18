import { describe, expect, it } from "vitest";
import { OpenApiController } from "./openapi.controller.js";
import type { OpenApiService } from "./openapi.service.js";

/** Captures the status the handler sets, so "unavailable" can be checked to actually SAY 503. */
function replyStub(): { status(code: number): unknown; code: number | null } {
  return {
    code: null as number | null,
    status(code: number) {
      this.code = code;
      return this;
    },
  };
}

function controllerWith(
  documentOrError: Record<string, unknown> | Error,
): OpenApiController {
  const service = {
    servedDocument: async () => {
      if (documentOrError instanceof Error) throw documentOrError;
      return documentOrError;
    },
  } as unknown as OpenApiService;
  return new OpenApiController(service);
}

const DOCUMENT = { openapi: "3.1.0", paths: {} };

describe("GET /docs", () => {
  it("embeds the document rather than pointing the browser at a second request", async () => {
    const html = await controllerWith(DOCUMENT).page(replyStub());
    expect(html).toContain('content: {"openapi":"3.1.0"');
    // The `url` form is what failed on the deployed environment: the page rendered its shell and
    // then could not load the document. Asserted on the CONFIG KEY, not on the string
    // "/docs/openapi.json" — the real document documents that route, so it appears in the page as
    // data. That assertion passed here only because this stub has no paths, which is the kind of
    // test that reports success for the wrong reason.
    expect(html).not.toContain("url:");
  });

  it("escapes `<` so no string in the document can close the script tag", async () => {
    const html = await controllerWith({
      openapi: "3.1.0",
      hostile: "</script><img src=x onerror=alert(1)>",
    }).page(replyStub());
    expect(html).toContain("\u003c/script\u003e");
    expect(html).not.toContain("</script><img");
  });

  it("degrades to an HTML page when the artifact cannot be read", async () => {
    // Not a thrown 503. `@Header` has already stamped `text/html`, and Nest's Fastify adapter only
    // repairs the content-type when the error body carries a `statusCode` key — which the error
    // envelope does not — so the JSON envelope went out as `text/html` and died in the serializer
    // as `500 Attempted to send payload of invalid type 'object'`. That destroyed the one message
    // naming the command that fixes it, at the only moment it existed.
    const reply = replyStub();
    const html = await controllerWith(new Error("artifact missing")).page(
      reply,
    );
    expect(html).toContain("The API reference is not available");
    expect(html).toContain("openapi:generate");
    // And it must SAY so: a body reading "unavailable" under a 200 is a lie a monitor believes.
    expect(reply.code).toBe(503);
  });

  it("renders once per process rather than re-serialising 300KB per request", async () => {
    let calls = 0;
    const service = {
      servedDocument: async () => {
        calls += 1;
        return DOCUMENT;
      },
    } as unknown as OpenApiService;
    const controller = new OpenApiController(service);
    await controller.page(replyStub());
    await controller.page(replyStub());
    expect(calls).toBe(1);
  });
});

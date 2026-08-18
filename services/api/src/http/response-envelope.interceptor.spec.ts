import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The three branches that decide whether a body is wrapped — an explicit `envelope: false`, a
 * declared non-JSON media type, and the runtime content-type — have each already shipped a bug in
 * this file's own history: the docs endpoint served a wrapped OpenAPI document, and the Meta
 * challenge echo was wrapped despite its binding declaring `text/plain`, which would have made
 * webhook verification impossible. Both were found by hand and neither had a test, so both could
 * recur silently. `response-validation.spec.ts` covers the easy half (mode resolution, checkPayload)
 * and never exercises this decision at all.
 */
const bindings = vi.hoisted(() => ({
  envelopeDisabled: false,
  successContentType: null as string | null,
  responseContract: null as unknown,
}));

vi.mock("../openapi/response-contracts.js", () => ({
  envelopeDisabledFor: () => bindings.envelopeDisabled,
  successContentTypeFor: () => bindings.successContentType,
  responseContractFor: () => bindings.responseContract,
}));

const { ResponseEnvelopeInterceptor } = await import(
  "./response-envelope.interceptor.js"
);

function contextWith(contentType?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: "req_test", headers: {} }),
      getResponse: () => ({ getHeader: () => contentType }),
    }),
    getClass: () => class Controller {},
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

const handlerReturning = (payload: unknown): CallHandler<unknown> => ({
  handle: () => of(payload),
});

async function run(
  context: ExecutionContext,
  payload: unknown,
): Promise<unknown> {
  return lastValueFrom(
    new ResponseEnvelopeInterceptor().intercept(
      context,
      handlerReturning(payload),
    ),
  );
}

describe("ResponseEnvelopeInterceptor", () => {
  beforeEach(() => {
    bindings.envelopeDisabled = false;
    bindings.successContentType = null;
    bindings.responseContract = null;
  });

  it("wraps a JSON body in { data, request_id }, reusing the request's own id", async () => {
    expect(await run(contextWith(), { total: 1 })).toEqual({
      data: { total: 1 },
      request_id: "req_test",
    });
  });

  it("leaves a body BARE when the binding sets envelope: false", async () => {
    // `GET /docs/openapi.json` must return an OpenAPI document, not a document inside `data`. No
    // media type distinguishes it from any other JSON, so only the opt-out can catch this.
    bindings.envelopeDisabled = true;
    expect(await run(contextWith(), { openapi: "3.1.0" })).toEqual({
      openapi: "3.1.0",
    });
  });

  it("leaves a body bare when the binding DECLARES a non-JSON media type", async () => {
    // The binding is authoritative because Fastify stamps the content-type after this runs. The
    // Meta handshake echoes a challenge string it compares verbatim; wrapping it breaks
    // verification, and the header alone would not have revealed that here.
    bindings.successContentType = "text/plain";
    expect(await run(contextWith(), "challenge-123")).toBe("challenge-123");
  });

  it("falls back to the runtime content-type when no binding declares one", async () => {
    // The CSV export sets its header at runtime.
    expect(await run(contextWith("text/csv"), "a,b\n1,2")).toBe("a,b\n1,2");
  });

  it("treats an absent content-type as JSON — Fastify's default for an object", async () => {
    expect(await run(contextWith(undefined), { ok: true })).toEqual({
      data: { ok: true },
      request_id: "req_test",
    });
  });

  it("passes an empty body through — 204 has nothing to wrap", async () => {
    expect(await run(contextWith(), undefined)).toBeUndefined();
    expect(await run(contextWith(), null)).toBeNull();
  });
});

/**
 * Validation must not depend on wrapping.
 *
 * These were one decision, so any route that opted out of the envelope was documented with a
 * response schema that was never checked — `GET /docs/openapi.json` among them, which is to say the
 * document describing every contract was the one response nobody verified.
 */
/** The thrown value is an HttpException whose stable `code` lives in its payload, not its message. */
async function violationCodeOf(payload: unknown): Promise<string> {
  try {
    await run(contextWith(), payload);
    return "no-throw";
  } catch (error) {
    const body = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      (body as { error?: { code?: string } } | undefined)?.error?.code ??
      "unknown"
    );
  }
}

describe("ResponseEnvelopeInterceptor validation is independent of wrapping", () => {
  beforeEach(() => {
    bindings.envelopeDisabled = false;
    bindings.successContentType = null;
    bindings.responseContract = null;
  });

  it("validates a body that is NOT enveloped (envelope: false)", async () => {
    bindings.envelopeDisabled = true;
    bindings.responseContract = z.object({ openapi: z.string() });
    expect(await violationCodeOf({ openapi: 123 })).toBe(
      "response_contract_violation",
    );
  });

  it("validates a body behind a declared non-JSON media type", async () => {
    bindings.successContentType = "text/csv";
    bindings.responseContract = z.string();
    expect(await violationCodeOf(42)).toBe("response_contract_violation");
  });

  it("still returns the un-enveloped body unchanged when it DOES match", async () => {
    bindings.envelopeDisabled = true;
    bindings.responseContract = z.object({ openapi: z.string() });
    expect(await run(contextWith(), { openapi: "3.1.0" })).toEqual({
      openapi: "3.1.0",
    });
  });
});

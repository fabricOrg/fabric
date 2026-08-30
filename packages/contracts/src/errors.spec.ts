import { describe, expect, it } from "vitest";
import { errorEnvelope, parseApiError } from "./errors.js";

// The pairing is the point: a producer that hand-rolls the envelope drifts from the parser, and the
// drift is SILENT — `parseApiError` never throws, it degrades to "Something went wrong" and
// `code: "unknown"`. So every builder is asserted through the parser rather than against a literal.
describe("errorEnvelope round-trips through parseApiError", () => {
  it("carries the code a caller branches on", () => {
    const parsed = parseApiError(
      errorEnvelope({
        type: "auth_error",
        code: "insufficient_permission",
        message: "Only owners and admins can change delivery mode.",
      }),
    );
    expect(parsed.type).toBe("auth_error");
    expect(parsed.code).toBe("insufficient_permission");
    expect(parsed.message).toBe(
      "Only owners and admins can change delivery mode.",
    );
  });

  it("keeps `param` so a form can mark the offending field", () => {
    const parsed = parseApiError(
      errorEnvelope({
        type: "invalid_request_error",
        code: "invalid_delivery_mode",
        message: "Choose either virtual or live.",
        param: "delivery_mode",
      }),
    );
    expect(parsed.param).toBe("delivery_mode");
  });

  it("omits request_id rather than inventing one, and parsing still succeeds", () => {
    const envelope = errorEnvelope({
      type: "api_error",
      code: "bff_error",
      message: "Request failed.",
    });
    expect("request_id" in envelope).toBe(false);
    // The generic message is what an UNPARSEABLE body produces, so its absence here is the proof
    // that the envelope parsed rather than degraded.
    expect(parseApiError(envelope).message).toBe("Request failed.");
  });
});

describe("parseApiError", () => {
  it("parses a well-formed F8.3 envelope with all fields", () => {
    const result = parseApiError({
      error: {
        type: "invalid_request_error",
        code: "parameter_invalid",
        message: "`to` must be a valid E.164 number.",
        param: "to",
        doc_url: "https://docs/errors/parameter_invalid",
      },
      request_id: "req_123",
    });

    expect(result).toEqual({
      type: "invalid_request_error",
      code: "parameter_invalid",
      message: "`to` must be a valid E.164 number.",
      param: "to",
      docUrl: "https://docs/errors/parameter_invalid",
      requestId: "req_123",
    });
  });

  it("omits optional fields when absent (exactOptionalPropertyTypes-safe)", () => {
    const result = parseApiError({
      error: { type: "auth_error", code: "unauthorized", message: "Nope." },
    });

    expect(result).toEqual({
      type: "auth_error",
      code: "unauthorized",
      message: "Nope.",
    });
    expect("param" in result).toBe(false);
    expect("requestId" in result).toBe(false);
  });

  it("degrades an unrecognized payload to a generic api_error and never throws", () => {
    const result = parseApiError({ something: "unexpected" });

    expect(result.type).toBe("api_error");
    expect(result.code).toBe("unknown");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("accepts the not_found_error type (404, e.g. GET /v1/sms/:id unknown id)", () => {
    const result = parseApiError({
      error: {
        type: "not_found_error",
        code: "resource_missing",
        message: "No such message.",
      },
      request_id: "req_404",
    });
    expect(result.type).toBe("not_found_error");
    expect(result.requestId).toBe("req_404");
  });

  it("uses the request-id fallback (e.g. from a response header) when the body omits it", () => {
    const result = parseApiError({ garbage: true }, "req_from_header");
    expect(result.requestId).toBe("req_from_header");
  });

  it("prefers the body request_id over the fallback", () => {
    const result = parseApiError(
      {
        error: {
          type: "rate_limit_error",
          code: "rate_limited",
          message: "Slow down.",
        },
        request_id: "req_body",
      },
      "req_header",
    );
    expect(result.requestId).toBe("req_body");
  });
});

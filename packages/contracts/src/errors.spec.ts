import { describe, expect, it } from "vitest";
import { parseApiError } from "./errors.js";

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

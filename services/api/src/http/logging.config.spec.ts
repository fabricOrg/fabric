import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  REDACTED_HEADER_PATHS,
  requestTenantId,
  resolveRequestId,
} from "./logging.config.js";

/** Minimal IncomingMessage stand-in (only what the helpers read). */
function req(
  headers: Record<string, string | string[]> = {},
  extra: Record<string, unknown> = {},
): IncomingMessage {
  return { headers, ...extra } as unknown as IncomingMessage;
}

describe("resolveRequestId", () => {
  it("honors a well-formed inbound x-request-id", () => {
    expect(
      resolveRequestId(req({ "x-request-id": "apigw-abc-123-def-456" })),
    ).toBe("apigw-abc-123-def-456");
  });

  it("mints a req_ id when the header is missing", () => {
    expect(resolveRequestId(req())).toMatch(/^req_/);
  });

  it("rejects malformed/oversized inbound ids (log-injection guard)", () => {
    expect(
      resolveRequestId(req({ "x-request-id": "bad id\nwith newline" })),
    ).toMatch(/^req_/);
    expect(resolveRequestId(req({ "x-request-id": "x".repeat(200) }))).toMatch(
      /^req_/,
    );
    expect(resolveRequestId(req({ "x-request-id": "short" }))).toMatch(/^req_/);
  });

  it("takes the first value of a repeated header", () => {
    expect(
      resolveRequestId(req({ "x-request-id": ["first-value-1", "second"] })),
    ).toBe("first-value-1");
  });
});

describe("requestTenantId", () => {
  it("returns the guard-attached tenant id", () => {
    expect(
      requestTenantId(
        req({}, { tenant: { id: "11111111-2222-3333-4444-555555555555" } }),
      ),
    ).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("returns undefined pre-auth or on malformed tenant", () => {
    expect(requestTenantId(req())).toBeUndefined();
    expect(requestTenantId(req({}, { tenant: { id: 42 } }))).toBeUndefined();
  });
});

describe("REDACTED_HEADER_PATHS", () => {
  it("covers every shared-secret header the API accepts", () => {
    const joined = REDACTED_HEADER_PATHS.join(" ");
    for (const h of [
      "authorization",
      "x-operator-token",
      "x-bff-token",
      "x-webhook-token",
      "cookie",
    ]) {
      expect(joined).toContain(h);
    }
  });
});

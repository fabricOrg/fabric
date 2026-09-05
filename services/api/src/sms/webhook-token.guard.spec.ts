import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

const TOKEN = "ab+cd/ef=gh";

function guardWith(configured: string): WebhookTokenGuard {
  return new WebhookTokenGuard({
    get: () => configured,
  } as never);
}

function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function allows(request: unknown, configured = TOKEN): boolean {
  try {
    return guardWith(configured).canActivate(contextFor(request)) === true;
  } catch {
    return false;
  }
}

describe("WebhookTokenGuard", () => {
  it("accepts the header, verbatim", () => {
    expect(allows({ headers: { "x-webhook-token": TOKEN } })).toBe(true);
  });

  /**
   * The regression. Arkesel delivery reports cannot set headers, so they carry the secret in the
   * query — and the PARSED query is form-decoded, turning a `+` into a space. Every live DLR was
   * rejected 401 while the identical token authenticated fine as a header.
   */
  it("accepts a literal + in the raw query, which form-decoding would turn into a space", () => {
    expect(
      allows({
        headers: {},
        url: `/webhooks/dlr/arkesel-sms?sms_id=abc&status=DELIVERED&token=${TOKEN}`,
        query: { token: TOKEN.replace(/\+/g, " ") }, // what the parsed query hands us
      }),
    ).toBe(true);
  });

  it("accepts the same secret percent-encoded", () => {
    expect(
      allows({
        headers: {},
        url: `/webhooks/dlr/arkesel-sms?token=${encodeURIComponent(TOKEN)}`,
      }),
    ).toBe(true);
  });

  it("still rejects a wrong token", () => {
    expect(
      allows({ headers: {}, url: "/webhooks/dlr/arkesel-sms?token=nope" }),
    ).toBe(false);
  });

  it("rejects when no credential is presented at all", () => {
    expect(allows({ headers: {}, url: "/webhooks/dlr/arkesel-sms" })).toBe(
      false,
    );
  });

  // Fail closed rather than accepting anything when the server has no token configured.
  it("rejects every request when the server has no token configured", () => {
    expect(allows({ headers: { "x-webhook-token": "anything" } }, "")).toBe(
      false,
    );
  });
});

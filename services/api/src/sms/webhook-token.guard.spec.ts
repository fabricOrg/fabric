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

/**
 * Only an `invalid_webhook_token` refusal counts as a rejection. Catching EVERY throw made a
 * TypeError from a future refactor read as "correctly rejected" in every negative test — the exact
 * failure these tests exist to catch.
 */
function allows(request: unknown, configured = TOKEN): boolean {
  try {
    return guardWith(configured).canActivate(contextFor(request)) === true;
  } catch (error) {
    const code = (
      error as { getResponse?: () => { error?: { code?: string } } }
    ).getResponse?.()?.error?.code;
    if (code !== "invalid_webhook_token") throw error;
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

  it.each([
    ["a key that merely ends in token", `?xtoken=${TOKEN}`],
    ["a key that merely starts with token", `?token_x=${TOKEN}`],
    ["an empty token", "?token="],
    ["a malformed percent-escape", "?token=%zz"],
  ])("rejects %s", (_name, query) => {
    expect(
      allows({ headers: {}, url: `/webhooks/dlr/arkesel-sms${query}` }),
    ).toBe(false);
  });

  // First match wins, so an attacker cannot append a valid token after a bogus one.
  it("takes the FIRST token parameter, not a later one", () => {
    expect(
      allows({
        headers: {},
        url: `/webhooks/dlr/arkesel-sms?token=wrong&token=${TOKEN}`,
      }),
    ).toBe(false);
  });

  // The documented fallback: no raw url available, only a parsed query.
  it("still accepts a parsed query token when no raw url is present", () => {
    expect(allows({ headers: {}, query: { token: TOKEN } })).toBe(true);
  });

  // Fail closed rather than accepting anything when the server has no token configured.
  it("rejects every request when the server has no token configured", () => {
    expect(allows({ headers: { "x-webhook-token": "anything" } }, "")).toBe(
      false,
    );
  });
});

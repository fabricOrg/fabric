import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { DocsAccessGuard } from "./docs-access.guard.js";

/**
 * This guard fronts the FULL specification — `/internal/admin/*` included: kill switches,
 * impersonation, wallet adjustment, staff management. The behaviour worth pinning is what it does
 * when it is MISCONFIGURED, because that is the state a fresh environment starts in.
 *
 * `http/edge-origin-guard.ts` returns `true` when its secret is unset. That is defensible there —
 * an absent edge secret must not 403 every provider webhook. It would be indefensible here, where
 * the same posture publishes the admin surface. These tests exist so nobody "makes them
 * consistent" later without the failure being loud.
 */

function guardWith(operatorToken: string | undefined): DocsAccessGuard {
  return new DocsAccessGuard({
    get: () => operatorToken,
  } as unknown as ConfigService);
}

function contextWith(headers: Record<string, string>): ExecutionContext {
  const responseHeaders: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => ({
        header: (name: string, value: string) => {
          responseHeaders[name] = value;
        },
        captured: responseHeaders,
      }),
    }),
  } as unknown as ExecutionContext;
}

const TOKEN = "an-operator-token-long-enough-to-be-real";

describe("DocsAccessGuard", () => {
  it("FAILS CLOSED when OPERATOR_TOKEN is unset — no token means no docs", () => {
    expect(() => guardWith(undefined).canActivate(contextWith({}))).toThrow();
  });

  it("treats an empty or whitespace token as unset rather than as a match", () => {
    // Guards against the classic: `secretsMatch("", "")` returning true and opening the surface.
    expect(() => guardWith("   ").canActivate(contextWith({}))).toThrow();
    expect(() =>
      guardWith("   ").canActivate(contextWith({ "x-operator-token": "" })),
    ).toThrow();
    expect(() =>
      guardWith("   ").canActivate(contextWith({ "x-operator-token": "   " })),
    ).toThrow();
  });

  it("answers 404 when disabled, not 401 — a 401 confirms the endpoint exists", () => {
    try {
      guardWith(undefined).canActivate(contextWith({}));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(404);
    }
  });

  it("answers 401 for a wrong token, so a configured operator can tell the two apart", () => {
    try {
      guardWith(TOKEN).canActivate(contextWith({ "x-operator-token": "nope" }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(401);
    }
  });

  it("accepts the header form, for curl and CI", () => {
    expect(
      guardWith(TOKEN).canActivate(contextWith({ "x-operator-token": TOKEN })),
    ).toBe(true);
  });

  it("accepts HTTP Basic with the token as the password, for browsers", () => {
    // A navigation cannot set a custom header. Without this path the UI would be unopenable and the
    // next person would reach for `?token=`, which lands the secret in history and proxy logs.
    const basic = Buffer.from(`ops:${TOKEN}`).toString("base64");
    expect(
      guardWith(TOKEN).canActivate(
        contextWith({ authorization: `Basic ${basic}` }),
      ),
    ).toBe(true);
  });

  it("ignores the username half of Basic — only the password is the secret", () => {
    const basic = Buffer.from(`${TOKEN}:wrong`).toString("base64");
    expect(() =>
      guardWith(TOKEN).canActivate(
        contextWith({ authorization: `Basic ${basic}` }),
      ),
    ).toThrow();
  });

  it("rejects a malformed Basic header instead of treating it as absent-and-allowed", () => {
    for (const value of ["Basic", "Basic !!!notbase64", "Bearer " + TOKEN]) {
      expect(() =>
        guardWith(TOKEN).canActivate(contextWith({ authorization: value })),
      ).toThrow();
    }
  });

  it("does NOT accept the token from a query parameter", () => {
    // Deliberately unlike the webhook ingress, which allows `?token=` because carriers cannot set
    // headers. A browser can, so a URL-borne secret buys nothing and leaks into history.
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, query: { token: TOKEN } }),
        getResponse: () => ({ header: () => undefined }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guardWith(TOKEN).canActivate(context)).toThrow();
  });
});

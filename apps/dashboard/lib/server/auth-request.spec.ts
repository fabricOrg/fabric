import { describe, expect, it } from "vitest";
import { isCrossSiteRequest } from "./auth-request";

function req(secFetchSite?: string): Request {
  const headers = new Headers();
  if (secFetchSite !== undefined) headers.set("sec-fetch-site", secFetchSite);
  return new Request("https://app.example.com/api/auth/sign-in", {
    method: "POST",
    headers,
  });
}

describe("isCrossSiteRequest (ADR-0008 login-CSRF guard)", () => {
  it("rejects a cross-site POST", () => {
    expect(isCrossSiteRequest(req("cross-site"))).toBe(true);
  });

  it("allows our own same-origin fetch", () => {
    expect(isCrossSiteRequest(req("same-origin"))).toBe(false);
  });

  it("allows a same-site sibling (e.g. dev-portal subdomain)", () => {
    expect(isCrossSiteRequest(req("same-site"))).toBe(false);
  });

  it("allows a direct action / absent header (POST-only routes)", () => {
    expect(isCrossSiteRequest(req("none"))).toBe(false);
    expect(isCrossSiteRequest(req())).toBe(false);
  });
});

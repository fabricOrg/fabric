import { describe, expect, it } from "vitest";
import {
  baselinePermissions,
  effectivePermissions,
  membershipPermissions,
} from "./permissions.js";

describe("membership permission baselines", () => {
  it("owner baseline is the full catalog", () => {
    expect(new Set(baselinePermissions("owner", false))).toEqual(
      new Set(membershipPermissions),
    );
  });

  it("member may draft (definitions:write) but not publish or manage apps", () => {
    const member = baselinePermissions("member", false);
    expect(member).toContain("definitions:write");
    expect(member).not.toContain("definitions:publish");
    expect(member).not.toContain("applications:write");
  });

  it("developer access adds api_keys/logs but not sms:send or definitions", () => {
    const withDev = baselinePermissions("member", true);
    expect(withDev).toContain("api_keys:write");
    expect(withDev).toContain("request_logs:read");
    // A member baseline already has sms:send; developer access adds nothing about definitions.
    expect(withDev).not.toContain("definitions:publish");
  });

  it("legacy developer role maps to the member baseline", () => {
    expect(new Set(baselinePermissions("developer", false))).toEqual(
      new Set(baselinePermissions("member", false)),
    );
  });
});

describe("effectivePermissions", () => {
  it("falls back to the baseline when there is no override", () => {
    expect(
      effectivePermissions({ role: "member", developerAccess: false }),
    ).toEqual(baselinePermissions("member", false));
  });

  it("uses the exact override set when present (role becomes a template)", () => {
    expect(
      effectivePermissions({
        role: "member",
        developerAccess: false,
        override: ["sms:read", "definitions:publish"],
      }),
    ).toEqual(["sms:read", "definitions:publish"]);
  });

  it("drops override entries outside the catalog", () => {
    expect(
      effectivePermissions({
        role: "admin",
        developerAccess: false,
        override: ["sms:send", "admin:everything", "not:real"],
      }),
    ).toEqual(["sms:send"]);
  });

  it("an empty override means no permissions (explicit lockdown, not a fallback)", () => {
    expect(
      effectivePermissions({
        role: "owner",
        developerAccess: true,
        override: [],
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  baselinePermissions,
  effectivePermissions,
  membershipPermissions,
  scopesExceedingPermissions,
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

  it("makes the member developer lane read-only for definitions", () => {
    const withDev = baselinePermissions("member", true);
    expect(withDev).toContain("api_keys:write");
    expect(withDev).toContain("request_logs:read");
    // Developer access is the read-only integration lane for managed definitions.
    expect(withDev).not.toContain("definitions:write");
    expect(withDev).not.toContain("definitions:publish");
  });

  it("does not reduce an owner or admin who also has developer access", () => {
    expect(new Set(baselinePermissions("owner", true))).toEqual(
      new Set(membershipPermissions),
    );
    expect(new Set(baselinePermissions("admin", true))).toEqual(
      new Set(membershipPermissions),
    );
  });

  it("keeps the legacy developer role least-privilege", () => {
    const legacy = baselinePermissions("developer", true);
    expect(new Set(legacy)).toEqual(
      new Set([
        "wallet:read",
        "applications:read",
        "api_keys:read",
        "api_keys:write",
        "request_logs:read",
      ]),
    );
    expect(legacy).not.toContain("sms:send");
    expect(legacy).not.toContain("email:send");
    expect(legacy).not.toContain("whatsapp:send");
    expect(legacy).not.toContain("messages:send");
    // Narrower than `member` on the READ side too, which is the half that reads like an accident
    // unless it is pinned: CLAUDE.md §4 scopes this role to API keys, logs and wallet-read.
    expect(legacy).not.toContain("sms:read");
    expect(legacy).not.toContain("email:read");
    expect(legacy).not.toContain("whatsapp:read");
    expect(legacy).not.toContain("messages:read");
    expect(legacy).not.toContain("definitions:write");
  });

  it("ignores the developer-access flag for the legacy developer role", () => {
    // The legacy role IS the person's whole authority, so the add-on flag cannot widen or narrow
    // it. Both callers coerce the flag today; the function must not depend on their doing so.
    expect(new Set(baselinePermissions("developer", false))).toEqual(
      new Set(baselinePermissions("developer", true)),
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

describe("scopesExceedingPermissions", () => {
  // The escalation this closes: `api_keys:write` is deliberately held by roles that cannot send,
  // so minting a key with `sms:send` turned "may manage keys" into "may spend the wallet".
  it("refuses a sending scope the caller does not hold", () => {
    const legacyDeveloper = baselinePermissions("developer", false);
    expect(legacyDeveloper).toContain("api_keys:write");
    expect(legacyDeveloper).not.toContain("sms:send");
    expect(
      scopesExceedingPermissions(
        ["sms:send", "api_keys:read"],
        legacyDeveloper,
      ),
    ).toEqual(["sms:send"]);
  });

  it("allows scopes the caller does hold", () => {
    const member = baselinePermissions("member", false);
    expect(
      scopesExceedingPermissions(["sms:send", "messages:read"], member),
    ).toEqual([]);
  });

  // Refusing what cannot be evaluated would break key creation rather than secure it, so a scope
  // with no membership counterpart passes. Only provable excess is refused.
  it("does not clamp a scope with no membership counterpart", () => {
    expect(scopesExceedingPermissions(["definitions:read"], [])).toEqual([]);
  });
});

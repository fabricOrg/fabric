import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertLeastPrivilege, isEntrypoint } from "./cloud-migrate.js";

describe("cloud migration entrypoint detection", () => {
  it("recognizes the same module through a resolved filesystem path", () => {
    expect(isEntrypoint(import.meta.url, fileURLToPath(import.meta.url))).toBe(
      true,
    );
  });

  it("fails closed for missing and invalid invocation paths", () => {
    expect(isEntrypoint(import.meta.url, undefined)).toBe(false);
    expect(isEntrypoint(import.meta.url, "not-a-real-entrypoint.js")).toBe(
      false,
    );
  });
});

describe("cloud database role verification", () => {
  it("accepts a login-only role", () => {
    expect(() =>
      assertLeastPrivilege("app_migrator", {
        canLogin: true,
        superuser: false,
        bypassRls: false,
        createDatabase: false,
        createRole: false,
        replication: false,
      }),
    ).not.toThrow();
  });

  it.each([
    "superuser",
    "bypassRls",
    "createDatabase",
    "createRole",
    "replication",
  ] as const)("rejects the %s privilege", (privilege) => {
    expect(() =>
      assertLeastPrivilege("app_runtime", {
        canLogin: true,
        superuser: false,
        bypassRls: false,
        createDatabase: false,
        createRole: false,
        replication: false,
        [privilege]: true,
      }),
    ).toThrow("app_runtime failed its least-privilege verification.");
  });

  it("rejects a missing role or one without login", () => {
    expect(() => assertLeastPrivilege("app_runtime", undefined)).toThrow();
    expect(() =>
      assertLeastPrivilege("app_runtime", {
        canLogin: false,
        superuser: false,
        bypassRls: false,
        createDatabase: false,
        createRole: false,
        replication: false,
      }),
    ).toThrow();
  });
});

import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDisposableDatabase } from "./disposable-database.js";

/**
 * A guard that has never been seen to refuse is not evidence. Both directions are pinned here against
 * a stubbed query rather than by poking a live database — including the CI and override short-circuits,
 * because a short-circuit is exactly how a guard silently stops guarding.
 */
function ownerReturning(
  rows: Array<{ id: string; name: string }>,
): postgres.Sql {
  // A tagged-template stand-in: calling it resolves to `rows`, and `.array` is the only helper the
  // guard uses. Cast through `unknown` in one step — reconstructing postgres.js's generic `array`
  // signature here would be more fiction than the stub itself.
  const sql = () => Promise.resolve(rows);
  Object.assign(sql, { array: (value: unknown) => value });
  return sql as unknown as postgres.Sql;
}

const FIXTURES = [
  "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
];

describe("assertDisposableDatabase", () => {
  const priorCi = process.env.CI;
  const priorOverride = process.env.ALLOW_DESTRUCTIVE_DB_TESTS;

  beforeEach(() => {
    delete process.env.CI;
    delete process.env.ALLOW_DESTRUCTIVE_DB_TESTS;
  });
  afterEach(() => {
    restore("CI", priorCi);
    restore("ALLOW_DESTRUCTIVE_DB_TESTS", priorOverride);
  });

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("allows a database holding only the spec's own fixtures", async () => {
    await expect(
      assertDisposableDatabase(ownerReturning([]), {
        fixtureTenantIds: FIXTURES,
        spec: "example",
      }),
    ).resolves.toBeUndefined();
  });

  it("REFUSES on a foreign account, and names what it protected", async () => {
    await expect(
      assertDisposableDatabase(
        ownerReturning([
          {
            id: "00000000-0000-0000-0000-0000000000e1",
            name: "Fabric Live Pilot",
          },
        ]),
        { fixtureTenantIds: FIXTURES, spec: "example spec" },
      ),
    ).rejects.toThrow(
      /refusing to wipe shared tenant tables[\s\S]*example spec[\s\S]*Fabric Live Pilot/,
    );
  });

  it("points at the way out rather than just refusing", async () => {
    // A guard that blocks without saying how to proceed gets deleted by the next person in a hurry.
    await expect(
      assertDisposableDatabase(
        ownerReturning([
          { id: "11111111-1111-1111-1111-111111111111", name: "Real" },
        ]),
        { fixtureTenantIds: FIXTURES, spec: "example" },
      ),
    ).rejects.toThrow(/scratch database|ALLOW_DESTRUCTIVE_DB_TESTS/);
  });

  it("skips under CI, where the database is created and thrown away", async () => {
    process.env.CI = "true";
    await expect(
      assertDisposableDatabase(
        ownerReturning([
          { id: "22222222-2222-2222-2222-222222222222", name: "Real" },
        ]),
        { fixtureTenantIds: FIXTURES, spec: "example" },
      ),
    ).resolves.toBeUndefined();
  });

  it("honours the explicit local override, and only the exact value", async () => {
    process.env.ALLOW_DESTRUCTIVE_DB_TESTS = "1";
    await expect(
      assertDisposableDatabase(
        ownerReturning([
          { id: "33333333-3333-3333-3333-333333333333", name: "Real" },
        ]),
        { fixtureTenantIds: FIXTURES, spec: "example" },
      ),
    ).resolves.toBeUndefined();

    // "true", "yes" and "0" must NOT open the gate — a near-miss value is how someone disables a
    // safety net while believing they set it.
    for (const value of ["true", "yes", "0", ""]) {
      process.env.ALLOW_DESTRUCTIVE_DB_TESTS = value;
      await expect(
        assertDisposableDatabase(
          ownerReturning([
            { id: "44444444-4444-4444-4444-444444444444", name: "Real" },
          ]),
          { fixtureTenantIds: FIXTURES, spec: "example" },
        ),
      ).rejects.toThrow(/refusing to wipe/);
    }
  });
});

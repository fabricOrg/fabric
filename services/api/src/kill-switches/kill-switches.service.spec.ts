import type { ProvisioningDb } from "@app/db";
import { drizzle } from "drizzle-orm/pg-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { KillSwitchService } from "./kill-switches.service.js";

/**
 * KILL-SWITCH READS — unit spec. `isPaused` sits in the SEND hot path; ARCHITECTURE Principle #7
 * says the control plane must never be in the data plane's. Proves: reads cache within TTL, a
 * control-plane failure serves last-known-good (never fails the send), TTL expiry refetches,
 * signupEnabled fails CLOSED, and precedence is platform OR tenant.
 *
 * THE FAKE DB IS A PROXY DRIVER, NOT A CHAINABLE STUB. The stub this replaced returned the same
 * rows for every query because its `where()` ignored its argument — so a query that forgot the
 * tenant predicate looked identical to one that had it, and the tenant/platform precedence bug it
 * was supposed to catch went straight through a green suite. Here the service builds REAL SQL and
 * this driver answers from a table, so dropping a predicate changes the answer, as it would in
 * Postgres.
 */

interface Row {
  key: string;
  tenantId: string | null;
  enabled: boolean;
}

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";

function fakeDb(table: () => Row[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    const key = params[0];
    // The service asks for the platform row alone or for platform + this tenant. Read the params
    // rather than the SQL so the assertion is about BEHAVIOUR, not phrasing — but only a uuid is a
    // tenant: `limit 1` binds a param too, and treating that 1 as a tenant id would quietly widen
    // the signup read.
    const tenantId = params.find(
      (p, i) => i > 0 && typeof p === "string" && p.includes("-"),
    );
    const rows = table().filter(
      (r) =>
        r.key === key &&
        (r.tenantId === null ||
          (tenantId !== undefined && r.tenantId === tenantId)),
    );
    return { rows: rows.map((r) => [r.enabled]) };
  }) as unknown as ProvisioningDb["db"];
  return { provisioning: { db } as unknown as ProvisioningDb, queries };
}

/** A driver that always throws, for the store-outage postures. */
function failingDb() {
  const db = drizzle(async () => {
    throw new Error("control-plane db down");
  }) as unknown as ProvisioningDb["db"];
  return { db } as unknown as ProvisioningDb;
}

const audit = { record: async () => undefined } as unknown as AuditService;

describe("KillSwitchService.isPaused cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves repeat reads within the TTL from cache — one DB query", async () => {
    const { provisioning, queries } = fakeDb(() => [
      { key: "platform.sms_sending", tenantId: null, enabled: true },
    ]);
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it("caches per tenant — one tenant's answer is not another's", async () => {
    const { provisioning, queries } = fakeDb(() => [
      { key: "platform.sms_sending", tenantId: null, enabled: true },
      { key: "platform.sms_sending", tenantId: TENANT, enabled: false },
    ]);
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending", TENANT)).toBe(true);
    expect(await svc.isPaused("platform.sms_sending", OTHER_TENANT)).toBe(
      false,
    );
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    // Three distinct questions → three reads. A shared entry would answer the wrong one.
    expect(queries).toHaveLength(3);
  });

  it("refetches after the TTL expires", async () => {
    let enabled = true;
    const { provisioning, queries } = fakeDb(() => [
      { key: "platform.sms_sending", tenantId: null, enabled },
    ]);
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    enabled = false; // flipped in the DB by another instance
    expect(await svc.isPaused("platform.sms_sending")).toBe(false); // still cached

    vi.advanceTimersByTime(31_000);
    expect(await svc.isPaused("platform.sms_sending")).toBe(true); // refetched
    expect(queries).toHaveLength(2);
  });

  it("serves last-known-good when the control-plane DB read fails", async () => {
    let fail = false;
    const { provisioning } = fakeDb(() => {
      if (fail) throw new Error("control-plane db down");
      return [{ key: "platform.sms_sending", tenantId: null, enabled: false }];
    });
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(true); // cached: paused
    fail = true;
    vi.advanceTimersByTime(31_000); // cache expired — forced to hit the failing DB
    // Stale beats down: the outage serves the last-known-good PAUSED, not a crash.
    expect(await svc.isPaused("platform.sms_sending")).toBe(true);
  });

  it("defaults to operational when the DB fails and nothing was ever cached", async () => {
    const svc = new KillSwitchService(failingDb(), audit);
    // A control-plane outage must never take down the data plane: no cache → operational.
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
  });
});

/**
 * PRECEDENCE: paused when the platform row OR the tenant row says so. A tenant override exists to
 * pause one workspace; it must never resume one past a platform halt — the whole reason the answer
 * is derived from both rows in one read instead of from whichever row was written last.
 */
describe("KillSwitchService.isPaused precedence", () => {
  const cases: Array<[string, boolean, boolean | null, boolean]> = [
    ["both operational", true, true, false],
    ["tenant paused", true, false, true],
    ["platform paused", false, true, true],
    ["both paused", false, false, true],
    ["platform paused, no tenant row", false, null, true],
    ["platform operational, no tenant row", true, null, false],
  ];

  for (const [name, platform, tenant, expected] of cases) {
    it(`${name} → paused=${expected}`, async () => {
      const rows: Row[] = [
        { key: "platform.sms_sending", tenantId: null, enabled: platform },
      ];
      if (tenant !== null) {
        rows.push({
          key: "platform.sms_sending",
          tenantId: TENANT,
          enabled: tenant,
        });
      }
      const { provisioning } = fakeDb(() => rows);
      const svc = new KillSwitchService(provisioning, audit);
      expect(await svc.isPaused("platform.sms_sending", TENANT)).toBe(expected);
    });
  }

  it("ignores another tenant's pause", async () => {
    const { provisioning } = fakeDb(() => [
      { key: "platform.sms_sending", tenantId: null, enabled: true },
      { key: "platform.sms_sending", tenantId: OTHER_TENANT, enabled: false },
    ]);
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.isPaused("platform.sms_sending", TENANT)).toBe(false);
  });

  it("asking without a tenant reads the platform row alone", async () => {
    const { provisioning, queries } = fakeDb(() => [
      { key: "platform.sms_sending", tenantId: null, enabled: true },
      { key: "platform.sms_sending", tenantId: TENANT, enabled: false },
    ]);
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    // The predicate, not just the result: a platform-only read must pin tenant_id IS NULL.
    expect(queries[0]?.sql).toMatch(/tenant_id"? is null/i);
    expect(queries[0]?.params).toHaveLength(1);
  });
});

/**
 * signupEnabled() is the ONE gate that FAILS CLOSED — opening a workspace to a stranger is an
 * abuse/cost action, so an unknown/unseeded/unreadable switch means signup is DISABLED (the opposite
 * of isPaused's fail-open posture). Platform-scoped: there is no tenant yet to scope it to.
 */
describe("KillSwitchService.signupEnabled (fail closed)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true only when the platform.signup switch is enabled", async () => {
    const { provisioning } = fakeDb(() => [
      { key: "platform.signup", tenantId: null, enabled: true },
    ]);
    expect(
      await new KillSwitchService(provisioning, audit).signupEnabled(),
    ).toBe(true);
  });

  it("returns false when the switch is disabled (paused)", async () => {
    const { provisioning } = fakeDb(() => [
      { key: "platform.signup", tenantId: null, enabled: false },
    ]);
    expect(
      await new KillSwitchService(provisioning, audit).signupEnabled(),
    ).toBe(false);
  });

  it("FAILS CLOSED when the switch is unseeded (no row) — signup disabled", async () => {
    const { provisioning } = fakeDb(() => []);
    expect(
      await new KillSwitchService(provisioning, audit).signupEnabled(),
    ).toBe(false);
  });

  it("FAILS CLOSED when the control-plane DB read fails and nothing was cached", async () => {
    // Unlike isPaused, an outage here denies signup rather than opening the door.
    expect(
      await new KillSwitchService(failingDb(), audit).signupEnabled(),
    ).toBe(false);
  });

  it("serves last-known-good enabled through a later DB outage", async () => {
    let fail = false;
    const { provisioning } = fakeDb(() => {
      if (fail) throw new Error("control-plane db down");
      return [{ key: "platform.signup", tenantId: null, enabled: true }];
    });
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.signupEnabled()).toBe(true); // cached: enabled
    fail = true;
    vi.advanceTimersByTime(31_000);
    expect(await svc.signupEnabled()).toBe(true); // last-known-good
  });
});

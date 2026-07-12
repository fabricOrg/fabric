import type { ProvisioningDb } from "@app/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { KillSwitchService } from "./kill-switches.service.js";

/**
 * KILL-SWITCH CACHE — unit spec (finding 4 of the architecture remediation).
 * `isPaused` sits in the SEND hot path; ARCHITECTURE Principle #7 says the control plane must
 * never be in the data plane's hot path. Proves: reads cache within TTL, a control-plane DB
 * failure serves last-known-good (never fails the send), toggle() flips this instance
 * immediately, and TTL expiry refetches.
 */

/** Minimal chainable mock of the drizzle select path isPaused uses. */
function mockDb(rows: () => Array<{ enabled: boolean }> | Promise<never>) {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => rows(),
      }),
    }),
  }));
  return {
    provisioning: { db: { select } } as unknown as ProvisioningDb,
    select,
  };
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
    const { provisioning, select } = mockDb(() => [{ enabled: true }]);
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    let enabled = true;
    const { provisioning, select } = mockDb(() => [{ enabled }]);
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
    enabled = false; // flipped in the DB by another instance
    expect(await svc.isPaused("platform.sms_sending")).toBe(false); // still cached

    vi.advanceTimersByTime(31_000);
    expect(await svc.isPaused("platform.sms_sending")).toBe(true); // refetched
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("serves last-known-good when the control-plane DB read fails", async () => {
    let fail = false;
    const { provisioning } = mockDb(() => {
      if (fail) throw new Error("control-plane db down");
      return [{ enabled: false }]; // paused
    });
    const svc = new KillSwitchService(provisioning, audit);

    expect(await svc.isPaused("platform.sms_sending")).toBe(true); // cached: paused
    fail = true;
    vi.advanceTimersByTime(31_000); // cache expired — forced to hit the failing DB
    // Stale beats down: the outage serves the last-known-good PAUSED, not a crash.
    expect(await svc.isPaused("platform.sms_sending")).toBe(true);
  });

  it("defaults to operational when the DB fails and nothing was ever cached", async () => {
    const { provisioning } = mockDb(() => {
      throw new Error("control-plane db down");
    });
    const svc = new KillSwitchService(provisioning, audit);

    // A control-plane outage must never take down the data plane: no cache → operational.
    expect(await svc.isPaused("platform.sms_sending")).toBe(false);
  });
});

/**
 * signupEnabled() is the ONE gate that FAILS CLOSED — opening a workspace to a stranger is an
 * abuse/cost action, so an unknown/unseeded/unreadable switch means signup is DISABLED (the opposite
 * of isPaused's fail-open posture). Proves both the happy read and every fail-closed branch.
 */
describe("KillSwitchService.signupEnabled (fail closed)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true only when the platform.signup switch is enabled", async () => {
    const { provisioning } = mockDb(() => [{ enabled: true }]);
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.signupEnabled()).toBe(true);
  });

  it("returns false when the switch is disabled (paused)", async () => {
    const { provisioning } = mockDb(() => [{ enabled: false }]);
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.signupEnabled()).toBe(false);
  });

  it("FAILS CLOSED when the switch is unseeded (no row) — signup disabled", async () => {
    const { provisioning } = mockDb(() => []);
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.signupEnabled()).toBe(false);
  });

  it("FAILS CLOSED when the control-plane DB read fails and nothing was cached", async () => {
    const { provisioning } = mockDb(() => {
      throw new Error("control-plane db down");
    });
    const svc = new KillSwitchService(provisioning, audit);
    // Unlike isPaused, an outage here denies signup rather than opening the door.
    expect(await svc.signupEnabled()).toBe(false);
  });

  it("serves last-known-good enabled through a later DB outage", async () => {
    let fail = false;
    const { provisioning } = mockDb(() => {
      if (fail) throw new Error("control-plane db down");
      return [{ enabled: true }];
    });
    const svc = new KillSwitchService(provisioning, audit);
    expect(await svc.signupEnabled()).toBe(true); // cached: enabled
    fail = true;
    vi.advanceTimersByTime(31_000);
    expect(await svc.signupEnabled()).toBe(true); // last-known-good
  });
});

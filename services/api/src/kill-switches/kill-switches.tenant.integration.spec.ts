import {
  accounts,
  createProvisioningDb,
  killSwitches,
  type TenantId,
} from "@app/db";
import { HttpException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { KillSwitchService } from "./kill-switches.service.js";

/**
 * TENANT-TARGETABLE KILL SWITCHES — integration spec on real Postgres.
 *
 * The unit spec proves the precedence ARITHMETIC against a fake driver; this proves the parts only
 * a database can answer: that the (key, tenant_id) uniqueness actually holds with NULLS NOT
 * DISTINCT, that the first flip for a workspace INSERTs its row and later ones amend it, and that a
 * toggle is visible to the very next read despite the hot-path cache.
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const KEY = "platform.sms_sending";
const audit = { record: async () => undefined } as unknown as AuditService;
const reason = "Tenant kill-switch integration spec";

describeDb("kill switches — tenant scope", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const svc = new KillSwitchService(provisioning, audit);
  let tenantId = "";
  let otherTenantId = "";

  /** A fresh service per assertion: the TTL cache is per instance, and stale reads aren't the subject. */
  function coldRead(): KillSwitchService {
    return new KillSwitchService(provisioning, audit);
  }

  async function setPlatform(enabled: boolean): Promise<void> {
    await provisioning.db
      .update(killSwitches)
      .set({ enabled })
      .where(and(eq(killSwitches.key, KEY), isNull(killSwitches.tenantId)));
  }

  beforeAll(async () => {
    await svc.list(); // seeds the catalog
    const [a, b] = await provisioning.db
      .insert(accounts)
      .values([
        { name: "KS Tenant A", slug: `ks-a-${Date.now()}` },
        { name: "KS Tenant B", slug: `ks-b-${Date.now()}` },
      ])
      .returning({ id: accounts.id });
    tenantId = a?.id ?? "";
    otherTenantId = b?.id ?? "";
  });

  afterAll(async () => {
    await setPlatform(true);
    for (const id of [tenantId, otherTenantId]) {
      if (!id) continue;
      // kill_switches.tenant_id is ON DELETE CASCADE, so the overrides go with the account.
      await provisioning.db
        .delete(accounts)
        .where(eq(accounts.id, id as TenantId));
    }
    await provisioning.end();
  });

  it("creates the override on first pause and amends it after", async () => {
    const paused = await svc.toggle(
      KEY,
      { enabled: false, reason, tenant_id: tenantId },
      { email: "ops@fabric.dev", staffId: null },
    );
    expect(paused).toMatchObject({
      tenant_id: tenantId,
      tenant_name: "KS Tenant A",
      enabled: false,
      // The override carries the platform row's identity, so a key means one thing at both scopes.
      label: "Platform SMS sending",
      scope: "platform",
    });

    const resumed = await svc.toggle(
      KEY,
      { enabled: true, reason, tenant_id: tenantId },
      { email: "ops@fabric.dev", staffId: null },
    );
    expect(resumed).toMatchObject({ tenant_id: tenantId, enabled: true });

    // Amended, not duplicated — the unique (key, tenant_id) is what makes this an upsert.
    const rows = await provisioning.db
      .select({ id: killSwitches.id })
      .from(killSwitches)
      .where(
        and(eq(killSwitches.key, KEY), eq(killSwitches.tenantId, tenantId)),
      );
    expect(rows).toHaveLength(1);
  });

  it("holds precedence across all six platform/tenant combinations", async () => {
    const cases: Array<[boolean, boolean | null, boolean]> = [
      [true, true, false], // both operational
      [true, false, true], // tenant paused
      [false, true, true], // platform paused — the override cannot resume past it
      [false, false, true], // both paused
      [false, null, true], // platform paused, no override
      [true, null, false], // platform operational, no override
    ];

    for (const [platform, tenant, expected] of cases) {
      await setPlatform(platform);
      if (tenant === null) {
        await provisioning.db
          .delete(killSwitches)
          .where(
            and(eq(killSwitches.key, KEY), eq(killSwitches.tenantId, tenantId)),
          );
      } else {
        await svc.toggle(
          KEY,
          { enabled: tenant, reason, tenant_id: tenantId },
          { email: "ops@fabric.dev", staffId: null },
        );
      }
      expect(await coldRead().isPaused(KEY, tenantId)).toBe(expected);
    }
  });

  it("pauses one workspace without touching another, or the platform question", async () => {
    await setPlatform(true);
    await svc.toggle(
      KEY,
      { enabled: false, reason, tenant_id: tenantId },
      { email: "ops@fabric.dev", staffId: null },
    );
    const read = coldRead();
    expect(await read.isPaused(KEY, tenantId)).toBe(true);
    expect(await read.isPaused(KEY, otherTenantId)).toBe(false);
    expect(await read.isPaused(KEY)).toBe(false);
  });

  it("a platform pause is visible to a tenant read the instant it is toggled", async () => {
    await setPlatform(true);
    await provisioning.db
      .delete(killSwitches)
      .where(
        and(eq(killSwitches.key, KEY), eq(killSwitches.tenantId, tenantId)),
      );

    // Warm the cache for the tenant question, THEN flip the platform row through the same service.
    // This is the bug the withdrawn implementation shipped: it cached what it had just written, so
    // a tenant entry derived from the tenant row alone survived a platform halt for a full TTL.
    expect(await svc.isPaused(KEY, tenantId)).toBe(false);
    await svc.toggle(
      KEY,
      { enabled: false, reason },
      { email: "ops@fabric.dev", staffId: null },
    );
    expect(await svc.isPaused(KEY, tenantId)).toBe(true);
  });

  it("lists overrides with their workspace, and flags the ones the platform moots", async () => {
    await setPlatform(false);
    await svc.toggle(
      KEY,
      { enabled: true, reason, tenant_id: tenantId },
      { email: "ops@fabric.dev", staffId: null },
    );
    const { switches } = await svc.list();
    const override = switches.find(
      (s) => s.key === KEY && s.tenant_id === tenantId,
    );
    expect(override).toMatchObject({
      tenant_name: "KS Tenant A",
      enabled: true,
      overridden_by_platform: true,
    });
    // The platform row itself is never "overridden" — it is the thing doing the overriding.
    const platform = switches.find(
      (s) => s.key === KEY && s.tenant_id === null,
    );
    expect(platform?.overridden_by_platform).toBe(false);
  });

  it("refuses to scope a platform-only switch to a workspace", async () => {
    // `platform.signup` is read before any workspace exists, so an override would sit in the table
    // looking meaningful while signupEnabled() never consults it.
    const error = await svc
      .toggle(
        "platform.signup",
        { enabled: false, reason, tenant_id: tenantId },
        { email: "ops@fabric.dev", staffId: null },
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      error: { code: "switch_not_tenant_scopable" },
    });
  });

  it("rejects an override for a workspace that does not exist", async () => {
    const error = await svc
      .toggle(
        KEY,
        {
          enabled: false,
          reason,
          tenant_id: "44444444-4444-4444-8444-444444444444",
        },
        { email: "ops@fabric.dev", staffId: null },
      )
      .catch((e: unknown) => e);
    // A structured 404, not the raw FK violation a bogus id would otherwise surface as.
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      error: { code: "tenant_not_found" },
    });
  });
});

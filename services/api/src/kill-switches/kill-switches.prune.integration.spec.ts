import { createProvisioningDb, killSwitches } from "@app/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { LIVE_PROVIDER_KEYS } from "./kill-switches.catalog.js";
import { KillSwitchService } from "./kill-switches.service.js";

/**
 * KILL-SWITCH CATALOG PRUNE — integration spec (finding 9). ensureCatalog (run on every list())
 * must delete dead `provider.*` switches with no adapter behind them, keep the real one, and
 * never touch platform switches. Runs on the provisioner (the only role with kill_switches DML —
 * which is exactly why a migration can't do this cleanup).
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const audit = { record: async () => undefined } as unknown as AuditService;

describeDb("kill-switch catalog prune", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const svc = new KillSwitchService(provisioning, audit);

  beforeAll(async () => {
    // Seed a dead provider switch as a prior deploy would have.
    await provisioning.db
      .insert(killSwitches)
      .values({
        key: "provider.zombie",
        label: "Zombie provider",
        description: "No adapter — should be pruned.",
        scope: "provider",
      })
      // Same conflict target as ensureCatalog — the unique key is (key, tenant_id) since 0133, and
      // a target naming `key` alone no longer matches a constraint.
      .onConflictDoNothing({
        target: [killSwitches.key, killSwitches.tenantId],
      });
  });

  afterAll(async () => {
    await provisioning.db
      .delete(killSwitches)
      .where(eq(killSwitches.key, "provider.zombie"));
    await provisioning.end();
  });

  it("prunes adapter-less provider switches, keeps every real one + platform switches", async () => {
    const { switches } = await svc.list(); // triggers ensureCatalog (seed + prune)
    const keys = switches.map((s) => s.key);

    expect(keys).not.toContain("provider.zombie");
    expect(keys).not.toContain("provider.africas-talking");
    expect(keys).not.toContain("provider.hubtel");
    expect(keys).toContain("platform.sms_sending"); // platform switch untouched
    expect(keys).toContain("platform.payments");

    // Derived from the catalog rather than naming one adapter. This used to assert
    // `provider.arkesel-sms` as "the one real adapter", which stopped being true the moment a second
    // channel shipped a provider — and it failed by naming meta-cloud, i.e. by finding a REAL switch,
    // which is the least useful way for a test to break. Deriving keeps the assertion meaningful in
    // both directions: every live adapter survives, and nothing else provider-scoped does.
    for (const key of LIVE_PROVIDER_KEYS) {
      expect(keys).toContain(key);
    }
    expect(LIVE_PROVIDER_KEYS.length).toBeGreaterThan(0);

    const strays = await provisioning.db
      .select({ key: killSwitches.key })
      .from(killSwitches)
      .where(
        and(eq(killSwitches.scope, "provider"), like(killSwitches.key, "%")),
      );
    for (const row of strays) {
      expect(LIVE_PROVIDER_KEYS).toContain(row.key);
    }
  });
});

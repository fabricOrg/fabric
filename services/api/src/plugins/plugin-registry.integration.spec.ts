import { createProvisioningDb, pluginInstances } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PluginRegistryService } from "./plugin-registry.service.js";

// Runs only when a real DB is configured (local docker / CI ephemeral); skipped otherwise.
const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

describeDb("plugin registry", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 1 });
  const service = new PluginRegistryService(db);

  // plugin_instances is GLOBAL config (no tenant) — the test owns the whole table on a local db.
  beforeAll(async () => {
    await db.db.delete(pluginInstances);
  });
  afterAll(async () => {
    await db.db.delete(pluginInstances);
    await db.end();
  });

  it("seeds the catalog on first list; FakeProvider is the SMS primary", async () => {
    const instances = await service.list();
    expect(instances.length).toBeGreaterThanOrEqual(7);
    const primary = instances.find(
      (i) => i.capability === "sms" && i.isDefault,
    );
    expect(primary?.vendor).toBe("fakeprovider");
    expect(primary?.enabled).toBe(true);
  });

  it("enable + make-default re-seats the primary (exactly one per capability)", async () => {
    const at = (await service.list()).find(
      (i) => i.capability === "sms" && i.vendor === "africas-talking",
    );
    expect(at).toBeDefined();
    if (!at) return;

    await service.apply(at.id, "enable");
    await service.apply(at.id, "make-default");

    const sms = (await service.list()).filter((i) => i.capability === "sms");
    expect(sms.filter((i) => i.isDefault)).toHaveLength(1);
    expect(sms.find((i) => i.isDefault)?.vendor).toBe("africas-talking");

    const chain = await service.resolve("sms");
    expect(chain[0]?.vendor).toBe("africas-talking"); // primary first
    expect(chain.map((i) => i.vendor)).toContain("fakeprovider"); // still enabled → in the chain
  });

  it("disable removes an instance from the resolve() chain", async () => {
    const fake = (await service.list()).find(
      (i) => i.capability === "sms" && i.vendor === "fakeprovider",
    );
    if (!fake) return;
    await service.apply(fake.id, "disable");
    const chain = await service.resolve("sms");
    expect(chain.map((i) => i.vendor)).not.toContain("fakeprovider");
  });
});

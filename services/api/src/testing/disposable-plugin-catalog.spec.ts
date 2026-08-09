import type { ProvisioningDb } from "@app/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDisposablePluginCatalog } from "./disposable-plugin-catalog.js";

/**
 * The guard exists because two integration specs delete every `plugin_instances` row, and on a
 * developer's database that table holds an operator's real configuration — a full suite run destroyed
 * a live Arkesel credential exactly once, irrecoverably. A guard that has never been seen to refuse is
 * not evidence, so both directions are pinned here rather than by poking a live database.
 */
function dbWithConfigured(
  rows: Array<{ capability: string; vendor: string; mode: string }>,
): ProvisioningDb {
  // Minimal stand-in for the drizzle chain the guard uses: select().from().where() resolves to rows.
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  return { db: chain } as unknown as ProvisioningDb;
}

describe("assertDisposablePluginCatalog", () => {
  // The guard short-circuits when CI is set, so these cases must own that variable rather than inherit
  // it. Without this the refusal case passes vacuously ON CI — the one place it is guaranteed to run.
  const priorCi = process.env.CI;
  beforeEach(() => {
    delete process.env.CI;
  });
  afterEach(() => {
    if (priorCi === undefined) delete process.env.CI;
    else process.env.CI = priorCi;
  });

  it("skips entirely under CI, where the database is thrown away anyway", async () => {
    process.env.CI = "true";
    await expect(
      assertDisposablePluginCatalog(
        dbWithConfigured([
          { capability: "whatsapp", vendor: "meta-cloud", mode: "live" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("allows a catalog with no installed credentials", async () => {
    await expect(
      assertDisposablePluginCatalog(dbWithConfigured([])),
    ).resolves.toBeUndefined();
  });

  it("REFUSES when a credential is installed, and names what it protected", async () => {
    await expect(
      assertDisposablePluginCatalog(
        dbWithConfigured([
          { capability: "sms", vendor: "arkesel", mode: "live" },
        ]),
      ),
    ).rejects.toThrow(
      /refusing to wipe the plugin catalog[\s\S]*sms\/arkesel \(live\)/,
    );
  });

  it("names every configured instance, so one is not fixed while another is lost", async () => {
    await expect(
      assertDisposablePluginCatalog(
        dbWithConfigured([
          { capability: "sms", vendor: "arkesel", mode: "live" },
          { capability: "payment", vendor: "paystack", mode: "sandbox" },
        ]),
      ),
    ).rejects.toThrow(/paystack \(sandbox\)/);
  });
});

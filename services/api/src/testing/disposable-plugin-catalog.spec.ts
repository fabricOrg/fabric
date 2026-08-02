import type { ProvisioningDb } from "@app/db";
import { describe, expect, it } from "vitest";
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

import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupPackages,
  type PackageTrack,
  seedPackagePurchase,
} from "./package-fixtures.js";
import { grantTokensForPurchase, listTokenBalances } from "./token-grant.js";
import { holdTokens } from "./token-holds.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for what `listTokenBalances` REPORTS, as opposed to what the grant writes.
 *
 * These are the numbers the credit tiles render, and each assertion exists because the obvious
 * shortcut is wrong: one counter cannot describe a mixed-expiry holding, a two-bucket split flattens
 * three distinct dates, and `granted - available` counts reservations and expiry as usage.
 */
describeDb("token balance reporting", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 2 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const deps = { provisioning, appDb };

  const tenants: string[] = [];
  const packages: PackageTrack = { bookIds: [], offerIds: [], staffIds: [] };

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db.insert(accounts).values({
      id: id as TenantId,
      name: "Token test",
      slug: `token-${id}`,
    });
    tenants.push(id);
    return id;
  }

  async function makeIntent(
    tenantId: string,
    over: Partial<{
      quantity: bigint;
      unitPrice: bigint;
      channel: string;
      currency: string;
      status: string;
      creditValidityDays: number | null;
    }> = {},
  ): Promise<string> {
    const quantity = over.quantity ?? 100n;
    const unitPrice = over.unitPrice ?? 4n;
    const { reference } = await seedPackagePurchase(provisioning, packages, {
      tenantId,
      channel: over.channel ?? "sms",
      quantity,
      totalPriceMinor: quantity * unitPrice,
      creditValidityDays: over.creditValidityDays ?? null,
    });
    if (over.currency && over.currency !== "GHS") {
      await provisioning.db
        .update(tokenPurchases)
        .set({ currency: over.currency })
        .where(eq(tokenPurchases.reference, reference));
    }
    if (over.status) {
      await provisioning.db
        .update(tokenPurchases)
        .set({ status: over.status })
        .where(eq(tokenPurchases.reference, reference));
    }
    return reference;
  }

  afterAll(async () => {
    for (const id of tenants) {
      // RESTRICT FKs everywhere on money history — delete children before the account.
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${id}::uuid`;
      // Holds reference their lot with a RESTRICT FK, so they go before the lots they point at.
      await owner`DELETE FROM token_holds WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_lots WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_counters WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_purchases WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM accounts WHERE id = ${id}::uuid`;
    }
    await cleanupPackages(owner, packages);
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("breaks a mixed balance down by expiry instead of dating all of it", async () => {
    const tenant = await makeTenant();
    // The shape a real workspace ends up in: one package with a validity window, one without.
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 40n, creditValidityDays: null }),
    );
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 200n, creditValidityDays: 60 }),
    );

    const [balance] = await appDb.withTenant(tenant, (tx) =>
      listTokenBalances(tx),
    );

    // The counter is one number, so `expiresNextAt` alone would have labelled all 240 as lapsing in
    // 60 days — false for the 40 that never do. The breakdown is what makes the tile honest.
    expect(balance?.available).toBe("240");
    expect(balance?.expiresNextAt).not.toBeNull();
    expect(balance?.expiryGroups).toHaveLength(2);
    // Dated first, permanent last — the order the UI renders without re-sorting.
    expect(balance?.expiryGroups[0]?.expiresAt).not.toBeNull();
    expect(balance?.expiryGroups[0]?.available).toBe("200");
    expect(balance?.expiryGroups[1]?.expiresAt).toBeNull();
    expect(balance?.expiryGroups[1]?.available).toBe("40");
    // Groups must reconcile to the counter, or the UI shows a balance that is not there.
    expect(
      (balance?.expiryGroups ?? []).reduce(
        (sum, group) => sum + BigInt(group.available),
        0n,
      ),
    ).toBe(BigInt(balance?.available ?? "0"));
  });

  it("keeps THREE different expiry dates apart, not just expiring vs permanent", async () => {
    const tenant = await makeTenant();
    // The case a two-bucket split silently flattened: several dated packages, each its own date.
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 10n, creditValidityDays: 30 }),
    );
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 20n, creditValidityDays: 60 }),
    );
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 5n, creditValidityDays: null }),
    );

    const [balance] = await appDb.withTenant(tenant, (tx) =>
      listTokenBalances(tx),
    );
    expect(balance?.available).toBe("35");
    expect(balance?.expiryGroups).toHaveLength(3);
    expect(balance?.expiryGroups.map((g) => g.available)).toEqual([
      "10",
      "20",
      "5",
    ]);
    // Soonest first; the permanent group sorts last however many dated ones precede it.
    expect(balance?.expiryGroups[2]?.expiresAt).toBeNull();
  });

  it("reports a wholly permanent balance as one group with no expiry date", async () => {
    const tenant = await makeTenant();
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 25n, creditValidityDays: null }),
    );

    const [balance] = await appDb.withTenant(tenant, (tx) =>
      listTokenBalances(tx),
    );
    expect(balance?.available).toBe("25");
    expect(balance?.expiresNextAt).toBeNull();
    expect(balance?.expiryGroups).toEqual([
      { expiresAt: null, available: "25" },
    ]);
  });

  it("reports granted and CONSUMED totals, not granted-minus-available", async () => {
    const tenant = await makeTenant();
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 100n, creditValidityDays: null }),
    );

    const before = await appDb.withTenant(tenant, (tx) =>
      listTokenBalances(tx),
    );
    expect(before[0]?.grantedTotal).toBe("100");
    expect(before[0]?.consumedTotal).toBe("0");

    // Reserve 4. A pending hold moves the COUNTER but not `quantity_consumed`, so "used" must not
    // count credits merely reserved by an in-flight send.
    await appDb.withTenant(tenant, async (tx) => {
      await holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 4n,
        referenceId: randomUUID(),
      });
    });

    const midFlight = await appDb.withTenant(tenant, (tx) =>
      listTokenBalances(tx),
    );
    expect(midFlight[0]?.available).toBe("96");
    expect(midFlight[0]?.grantedTotal).toBe("100");
    // granted - available would already claim 4 were spent. They are only reserved.
    expect(midFlight[0]?.consumedTotal).toBe("0");
  });
});

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
import { grantTokensForPurchase, readTokenBalance } from "./token-grant.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for the ADR-0010 Phase 2 token grant. This is money-adjacent, so the
 * assertions are the INVARIANTS the wallet/security review named, not just the happy call:
 * grant-once under replay, the deferred-revenue leg (not revenue), the counter never running ahead
 * of its lots, the DB floor on charge-vs-entitlement drift, and tenant isolation.
 */
describeDb("token grant", () => {
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
    }> = {},
  ): Promise<string> {
    const quantity = over.quantity ?? 100n;
    const unitPrice = over.unitPrice ?? 4n;
    const { reference } = await seedPackagePurchase(provisioning, packages, {
      tenantId,
      channel: over.channel ?? "sms",
      quantity,
      totalPriceMinor: quantity * unitPrice,
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

  /** The ledger legs this purchase posted, as (kind, direction, amount). */
  async function legsFor(tenantId: string, reference: string) {
    return (await owner`
      SELECT a.kind, e.direction, e.amount_minor::text AS amount, e.reason
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      JOIN ledger_transactions t ON t.id = e.txn_id
      WHERE e.tenant_id = ${tenantId}::uuid AND t.idempotency_key = ${reference}
      ORDER BY a.kind`) as {
      kind: string;
      direction: string;
      amount: string;
      reason: string;
    }[];
  }

  afterAll(async () => {
    for (const id of tenants) {
      // RESTRICT FKs everywhere on money history — delete children before the account.
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${id}::uuid`;
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

  it("grants a lot, raises the counter, and books the cash as DEFERRED revenue", async () => {
    const tenant = await makeTenant();
    const reference = await makeIntent(tenant, {
      quantity: 100n,
      unitPrice: 4n,
    });

    const result = await grantTokensForPurchase(deps, reference);
    expect(result.granted).toBe(true);
    expect(result.lots[0]?.quantity).toBe(100n);

    const balance = await appDb.withTenant(tenant, (tx) =>
      readTokenBalance(tx, "sms", "GHS"),
    );
    expect(balance).toBe(100n);

    // The money half: cash in (gateway debit) against the LIABILITY, never straight to revenue —
    // revenue is only recognized as tokens are consumed (slice 2c).
    const legs = await legsFor(tenant, reference);
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => `${l.kind}:${l.direction}:${l.amount}`)).toEqual([
      "gateway_clearing:debit:400",
      "token_deferred_revenue:credit:400",
    ]);
    expect(legs.every((l) => l.reason === "token_purchase")).toBe(true);
  });

  it("is idempotent: a replayed grant mints no second lot, counter, or movement", async () => {
    const tenant = await makeTenant();
    const reference = await makeIntent(tenant, { quantity: 50n });

    const first = await grantTokensForPurchase(deps, reference);
    const second = await grantTokensForPurchase(deps, reference);
    const third = await grantTokensForPurchase(deps, reference);

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(third.granted).toBe(false);
    // Same lot, same ledger txn — the replays resolved to the original, they did not create one.
    expect(second.lots[0]?.lotId).toBe(first.lots[0]?.lotId);
    expect(second.txnId).toBe(first.txnId);

    const lots = (await owner`
      SELECT count(*)::int AS n FROM token_lots
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    expect(lots[0]?.n).toBe(1);

    // The counter is the one that would silently over-credit on replay — assert it did not.
    const balance = await appDb.withTenant(tenant, (tx) =>
      readTokenBalance(tx, "sms", "GHS"),
    );
    expect(balance).toBe(50n);
    expect(await legsFor(tenant, reference)).toHaveLength(2);
  });

  it("accumulates separate purchases into one (channel, currency) counter", async () => {
    const tenant = await makeTenant();
    const first = await makeIntent(tenant, { quantity: 30n });
    const second = await makeIntent(tenant, { quantity: 12n });

    await grantTokensForPurchase(deps, first);
    await grantTokensForPurchase(deps, second);

    const balance = await appDb.withTenant(tenant, (tx) =>
      readTokenBalance(tx, "sms", "GHS"),
    );
    expect(balance).toBe(42n);
  });

  it("keeps counters separate per channel and per currency (review §6.3 granularity)", async () => {
    const tenant = await makeTenant();
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 5n, channel: "sms" }),
    );
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 7n, channel: "email" }),
    );
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 9n, currency: "NGN" }),
    );

    const [sms, email, ngn] = await appDb.withTenant(tenant, async (tx) => [
      await readTokenBalance(tx, "sms", "GHS"),
      await readTokenBalance(tx, "email", "GHS"),
      await readTokenBalance(tx, "sms", "NGN"),
    ]);
    expect({ sms, email, ngn }).toEqual({ sms: 5n, email: 7n, ngn: 9n });
  });

  it("refuses a failed purchase and an unknown reference", async () => {
    const tenant = await makeTenant();
    const failed = await makeIntent(tenant, { status: "failed" });

    await expect(grantTokensForPurchase(deps, failed)).rejects.toMatchObject({
      // Fail closed: a rejected payment must never later mint an entitlement.
      response: { error: { code: "token_purchase_failed" } },
    });
    await expect(
      grantTokensForPurchase(deps, `token-${randomUUID()}`),
    ).rejects.toMatchObject({
      response: { error: { code: "token_purchase_not_found" } },
    });

    const lots = (await owner`
      SELECT count(*)::int AS n FROM token_lots
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    expect(lots[0]?.n).toBe(0);
  });

  it("rejects at the DB when the charge and the entitlement disagree", async () => {
    const tenant = await makeTenant();
    // A purchase with no offer provenance at all — the class of bug the CHECK exists to make
    // impossible now that every purchase must descend from a published package.
    // Inserted on the raw connection so the assertion sees the DB's own constraint name; drizzle
    // wraps the driver error in a generic "Failed query" message that would hide which guard fired.
    const violation = await owner`
      INSERT INTO token_purchases (
        tenant_id, reference, currency, amount_minor, email
      ) VALUES (
        ${tenant}::uuid, ${`token-${randomUUID()}`}, 'GHS', 40, 'buyer@example.com'
      )`.catch((error: { constraint_name?: string }) => error);
    expect(violation).toMatchObject({
      constraint_name: "token_purchases_amount_chk",
    });
  });

  it("cannot drive a counter negative (the entitlement floor)", async () => {
    const tenant = await makeTenant();
    await grantTokensForPurchase(
      deps,
      await makeIntent(tenant, { quantity: 3n }),
    );

    await expect(
      owner`
        UPDATE token_counters SET available = available - 10
        WHERE tenant_id = ${tenant}::uuid`,
    ).rejects.toThrow(/token_counters_available_chk/);
  });

  it("isolates lots by tenant under RLS", async () => {
    const mine = await makeTenant();
    const theirs = await makeTenant();
    await grantTokensForPurchase(
      deps,
      await makeIntent(mine, { quantity: 8n }),
    );

    // The other tenant's context must not see my lot, nor my balance.
    const seen = await appDb.withTenant(theirs, async (tx) => {
      const rows = (await tx`SELECT count(*)::int AS n FROM token_lots`) as {
        n: number;
      }[];
      return {
        lots: rows[0]?.n ?? -1,
        balance: await readTokenBalance(tx, "sms", "GHS"),
      };
    });
    expect(seen).toEqual({ lots: 0, balance: 0n });
  });
});

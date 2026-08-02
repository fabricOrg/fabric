import { randomUUID } from "node:crypto";
import {
  accounts,
  checkTokenReconciliation,
  createAppDb,
  createProvisioningDb,
  formatTokenReconciliation,
  type TenantId,
} from "@app/db";
import { FakeProvider } from "@app/integrations/testing";
import { dispatchSend, prepareSend, type SendInput } from "@app/sms-engine";
import { creditTokenPurchase } from "@app/wallet";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupPackages,
  type PackageTrack,
  seedPackagePurchase,
} from "./package-fixtures.js";
import { grantTokensForPurchase } from "./token-grant.js";
import { holdTokens } from "./token-holds.js";
import { settleTokenHolds } from "./token-settlement.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for the prepaid-credit reconciliation (roadmap COM-010).
 *
 * Driven in BOTH directions, because a reconciliation that has only ever been seen to pass is not
 * evidence: each comparison is shown to go red on an injected divergence of exactly the shape it
 * exists to catch, and green on a genuine lifecycle.
 *
 * ASSERTIONS ARE SCOPED TO THIS SPEC'S OWN TENANTS, while the QUERY stays global. The check compares
 * every workspace on the database, so asserting `ok === true` outright would make the spec a report on
 * whatever residue other specs left behind — which is precisely why the sibling GL reconciliation spec
 * fails on a long-lived local database. Filtering the findings keeps the real query under test while
 * making the verdict about this spec's own data.
 */
describeDb("prepaid credit reconciliation (COM-010)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 4 });
  const owner = postgres(superUrl ?? "", { max: 2 });
  const tenants: string[] = [];
  const packages: PackageTrack = { bookIds: [], offerIds: [], staffIds: [] };

  const deps = {
    db: appDb,
    provider: new FakeProvider(),
    tokens: { hold: holdTokens, resolve: settleTokenHolds },
  };

  const executor = {
    query: async (q: string) => ({
      rows: (await owner.unsafe(q)) as Array<Record<string, unknown>>,
    }),
  };

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db
      .insert(accounts)
      .values({ id: id as TenantId, name: "Recon test", slug: `recon-${id}` });
    tenants.push(id);
    return id;
  }

  async function grantTokens(
    tenantId: string,
    quantity: bigint,
    unitPrice: bigint,
  ): Promise<void> {
    const { reference } = await seedPackagePurchase(provisioning, packages, {
      tenantId,
      quantity,
      totalPriceMinor: quantity * unitPrice,
    });
    await grantTokensForPurchase({ provisioning, appDb }, reference);
  }

  function inputFor(tenantId: string, body: string): SendInput {
    return {
      tenantId,
      to: "+233200000001",
      senderId: "FABRIC",
      body,
      currency: "GHS",
      deliveryMode: "live",
    };
  }

  /** Everything the check found about ONE tenant — see the scope note above. */
  async function findingsFor(tenantId: string): Promise<{
    entitlement: number;
    deferredRevenue: number;
    allocationTrail: number;
    blind: boolean;
    report: string;
  }> {
    const r = await checkTokenReconciliation(executor);
    const lots = (await owner`
      SELECT id::text AS id FROM token_lots WHERE tenant_id = ${tenantId}::uuid`) as {
      id: string;
    }[];
    const lotIds = new Set(lots.map((l) => l.id));
    const mine = {
      entitlement: r.entitlement.filter((e) => e.tenantId === tenantId),
      deferredRevenue: r.deferredRevenue.filter((d) => d.tenantId === tenantId),
      allocationTrail: r.allocationTrail.filter((a) => lotIds.has(a.lotId)),
    };
    return {
      entitlement: mine.entitlement.length,
      deferredRevenue: mine.deferredRevenue.length,
      allocationTrail: mine.allocationTrail.length,
      blind: r.coverage.blind,
      // The full formatted report, so a failing assertion says WHAT diverged rather than "1 vs 0".
      report: formatTokenReconciliation({ ...r, ...mine }),
    };
  }

  afterAll(async () => {
    for (const id of tenants) {
      await owner`DELETE FROM token_recognition_allocations WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_holds WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM message_dispatches WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM outbox_events WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM messages WHERE tenant_id = ${id}::uuid`;
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

  it("reconciles a real lifecycle: purchase, a delivered send, and an in-flight hold", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);

    // Delivered: advances quantity_consumed, recognizes 4 into revenue, writes an allocation row.
    const delivered = inputFor(tenant, "delivered");
    await dispatchSend(deps, delivered, await prepareSend(deps, delivered));
    // Left pending on purpose — the hold must be subtracted from the counter exactly ONCE, and a
    // committed one must not be subtracted again. A lifecycle with only settled holds cannot tell
    // those two mistakes apart.
    const inFlight = inputFor(tenant, "still in flight");
    await prepareSend(deps, inFlight);

    const found = await findingsFor(tenant);
    expect(found.report).toContain("reconcile");
    expect(found.entitlement).toBe(0);
    expect(found.deferredRevenue).toBe(0);
    expect(found.allocationTrail).toBe(0);
    expect(found.blind).toBe(false);
  });

  it("catches a counter that drifted from the lots and holds behind it", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);

    // The exact defect this check exists for: the cached projection the send path gates on says the
    // workspace owns 5 more sends than its lots do. No double-entry invariant can see this — a
    // counter is a projection of COUNTS, and nothing about the money is unbalanced.
    await owner`
      UPDATE token_counters SET available = available + 5
      WHERE tenant_id = ${tenant}::uuid`;

    const found = await findingsFor(tenant);
    expect(found.entitlement).toBe(1);
    expect(found.report).toContain("off by 5");
    // Money is untouched, so the other two comparisons must stay quiet — a check that reports every
    // problem for every cause tells an operator nothing about where to look.
    expect(found.deferredRevenue).toBe(0);
    expect(found.allocationTrail).toBe(0);
  });

  it("catches cash taken as deferred revenue that no lot ever backed", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);

    // A purchase movement posts, and the grant never lands — the customer paid for credits they do
    // not have. Balanced (gateway_clearing → token_deferred_revenue), so the ledger invariants are
    // perfectly happy; only the comparison against entitlement can see it.
    await appDb.withTenant(tenant, (tx) =>
      creditTokenPurchase(tx, {
        currency: "GHS",
        amountMinor: 250n,
        idempotencyKey: `token-orphan-${tenant}`,
        purchaseId: randomUUID(),
      }),
    );

    const found = await findingsFor(tenant);
    expect(found.deferredRevenue).toBe(1);
    expect(found.report).toContain("off by 250");
    expect(found.entitlement).toBe(0);
    expect(found.allocationTrail).toBe(0);
  });

  it("catches a lot whose position no longer matches its own allocation rows", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const input = inputFor(tenant, "delivered");
    await dispatchSend(deps, input, await prepareSend(deps, input));

    // Drop the evidence and leave the running total. The lot's CHECK constraints all still hold, and
    // the ledger still balances — the allocation rows are the only record that can contradict it.
    await owner`
      DELETE FROM token_recognition_allocations WHERE tenant_id = ${tenant}::uuid`;

    const found = await findingsFor(tenant);
    expect(found.allocationTrail).toBe(1);
    expect(found.report).toContain("vs allocations 0");
    expect(found.entitlement).toBe(0);
    expect(found.deferredRevenue).toBe(0);
  });

  it("refuses to call blindness agreement", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);

    // Reproduce the DEPLOYED role exactly. `db:assert` used to run every gate as
    // DATABASE_URL_OWNER, which is a superuser locally but the non-superuser `app_migrator` in the
    // cloud — and every token table is FORCE RLS with a policy naming app_provisioner only. Under
    // that role the comparison scans zero rows, finds zero discrepancies, and would report success.
    const blindSql = postgres(superUrl ?? "", { max: 1 });
    try {
      await blindSql`SET ROLE app_migrator`;
      const blindExecutor = {
        query: async (q: string) => ({
          rows: (await blindSql.unsafe(q)) as Array<Record<string, unknown>>,
        }),
      };
      const r = await checkTokenReconciliation(blindExecutor);
      expect(r.coverage.blind).toBe(true);
      expect(r.ok).toBe(false);
      expect(formatTokenReconciliation(r)).toContain("BLIND");
    } finally {
      await blindSql.end();
    }
    // Sanity: the same comparison on a capable connection is NOT blind, so the assertion above is
    // about the role and not about the check being broken.
    expect((await findingsFor(tenant)).blind).toBe(false);
  });
});

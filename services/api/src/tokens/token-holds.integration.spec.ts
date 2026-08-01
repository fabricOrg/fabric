import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type MinorUnits,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { grantTokensForPurchase, readTokenBalance } from "./token-grant.js";
import { holdTokens, resolveTokenHolds } from "./token-holds.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for the token hold lifecycle (ADR-0010 slice 2b). These are the count-space
 * equivalents of the wallet invariants: no double-spend under concurrency, all-or-nothing claims,
 * FIFO lot draw (which decides the price recognized in 2c), and commit-XOR-return.
 */
describeDb("token holds", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 6 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const deps = { provisioning, appDb };
  const tenants: string[] = [];

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db
      .insert(accounts)
      .values({ id: id as TenantId, name: "Hold test", slug: `hold-${id}` });
    tenants.push(id);
    return id;
  }

  /** Grant `quantity` tokens at `unitPrice`, so lots can be stacked at different locked prices. */
  async function grant(
    tenantId: string,
    quantity: bigint,
    unitPrice = 4n,
    channel = "sms",
  ): Promise<void> {
    const reference = `token-${randomUUID()}`;
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      channel,
      quantity,
      unitPriceMinorLocked: unitPrice as MinorUnits,
      currency: "GHS",
      amountMinor: (quantity * unitPrice) as MinorUnits,
      email: "buyer@example.com",
    });
    await grantTokensForPurchase(deps, reference);
  }

  const balance = (tenantId: string) =>
    appDb.withTenant(tenantId, (tx) => readTokenBalance(tx, "sms", "GHS"));

  afterAll(async () => {
    for (const id of tenants) {
      await owner`DELETE FROM token_recognition_allocations WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_holds WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_lots WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_counters WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_purchases WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM accounts WHERE id = ${id}::uuid`;
    }
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("holds a multi-segment quantity and takes it off the spendable counter", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 10n);

    // SMS is priced per SEGMENT, so a 3-segment message claims 3 tokens — not 1.
    const result = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 3n,
        referenceId: randomUUID(),
      }),
    );
    expect(result.held).toBe(true);
    expect(result.replayed).toBe(false);
    expect(await balance(tenant)).toBe(7n);
  });

  it("refuses rather than partially holding when the balance is short", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 2n);

    const result = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 5n,
        referenceId: randomUUID(),
      }),
    );
    // All-or-nothing: the caller falls through to the wallet, never a split charge.
    expect(result).toMatchObject({ held: false, allocations: [] });
    expect(await balance(tenant)).toBe(2n);
  });

  it("draws lots FIFO, so the oldest locked price is the one consumed", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 2n, 4n); // older, cheaper
    await grant(tenant, 5n, 9n); // newer, dearer

    const result = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 3n,
        referenceId: randomUUID(),
      }),
    );
    // Spans both lots: 2 from the old one, then 1 from the new — one row per lot, each carrying its
    // own locked price so 2c can recognize revenue unambiguously.
    expect(
      result.allocations.map((a) => `${a.quantity}@${a.unitPriceMinorLocked}`),
    ).toEqual(["2@4", "1@9"]);
    expect(await balance(tenant)).toBe(4n);
  });

  it("is idempotent for a retried accept on the same send", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 10n);
    const reference = randomUUID();

    const first = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 4n,
        referenceId: reference,
      }),
    );
    const replay = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 4n,
        referenceId: reference,
      }),
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.held).toBe(true);
    // The retry must not claim a second set of tokens.
    expect(await balance(tenant)).toBe(6n);
  });

  it("never double-spends under concurrent sends for the last tokens", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 5n);

    // Six concurrent 1-token sends against a balance of 5 — exactly five may win.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        appDb.withTenant(tenant, (tx) =>
          holdTokens(tx, {
            channel: "sms",
            currency: "GHS",
            quantity: 1n,
            referenceId: randomUUID(),
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.held)).toHaveLength(5);
    expect(await balance(tenant)).toBe(0n);
  });

  it("commit spends the tokens; the counter does not move twice", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 10n);
    const reference = randomUUID();
    await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 3n,
        referenceId: reference,
      }),
    );

    const committed = await appDb.withTenant(tenant, (tx) =>
      resolveTokenHolds(tx, reference, "committed"),
    );
    expect(committed).toHaveLength(1);
    expect(committed[0]?.quantity).toBe(3n);
    // The counter moved at hold time — committing must not move it again.
    expect(await balance(tenant)).toBe(7n);

    // Repeat (a duplicate callback) transitions nothing.
    const again = await appDb.withTenant(tenant, (tx) =>
      resolveTokenHolds(tx, reference, "committed"),
    );
    expect(again).toEqual([]);
    expect(await balance(tenant)).toBe(7n);
  });

  it("return puts the tokens back exactly once", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 10n);
    const reference = randomUUID();
    await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 4n,
        referenceId: reference,
      }),
    );
    expect(await balance(tenant)).toBe(6n);

    await appDb.withTenant(tenant, (tx) =>
      resolveTokenHolds(tx, reference, "returned"),
    );
    expect(await balance(tenant)).toBe(10n);

    // A sweeper re-running after the failure callback must not refund a second time.
    const again = await appDb.withTenant(tenant, (tx) =>
      resolveTokenHolds(tx, reference, "returned"),
    );
    expect(again).toEqual([]);
    expect(await balance(tenant)).toBe(10n);
  });

  it("commit XOR return: a callback and a sweeper racing resolve it once", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 10n);
    const reference = randomUUID();
    await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "sms",
        currency: "GHS",
        quantity: 2n,
        referenceId: reference,
      }),
    );

    const [commit, ret] = await Promise.all([
      appDb.withTenant(tenant, (tx) =>
        resolveTokenHolds(tx, reference, "committed"),
      ),
      appDb.withTenant(tenant, (tx) =>
        resolveTokenHolds(tx, reference, "returned"),
      ),
    ]);
    // Exactly one side transitioned the pending rows; the other saw none.
    expect([commit.length > 0, ret.length > 0].filter(Boolean)).toHaveLength(1);
    // Balance is 8 if it committed (tokens spent), 10 if it returned — never 6 or 12.
    expect([8n, 10n]).toContain(await balance(tenant));

    const statuses = (await owner`
      SELECT DISTINCT status FROM token_holds
      WHERE tenant_id = ${tenant}::uuid AND reference_id = ${reference}::uuid`) as {
      status: string;
    }[];
    expect(statuses).toHaveLength(1);
    expect(["committed", "returned"]).toContain(statuses[0]?.status);
  });

  it("keeps entitlement per channel: an email send cannot spend SMS tokens", async () => {
    const tenant = await makeTenant();
    await grant(tenant, 5n, 4n, "sms");

    const result = await appDb.withTenant(tenant, (tx) =>
      holdTokens(tx, {
        channel: "email",
        currency: "GHS",
        quantity: 1n,
        referenceId: randomUUID(),
      }),
    );
    expect(result.held).toBe(false);
    expect(await balance(tenant)).toBe(5n);
  });
});

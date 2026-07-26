import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type MinorUnits,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import { FakeProvider } from "@app/integrations/testing";
import {
  dispatchSend,
  failPreparedSend,
  prepareSend,
  type SendInput,
} from "@app/sms-engine";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { grantTokensForPurchase } from "./token-grant.js";
import { holdTokens } from "./token-holds.js";
import { settleTokenHolds } from "./token-settlement.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for token revenue recognition (ADR-0010 slice 2c-i).
 *
 * The accounting claim under test: cash taken for tokens is a LIABILITY until the send is delivered.
 * A purchase credits `token_deferred_revenue`; only consumption discharges it into `revenue`, at the
 * LOT'S LOCKED price. Unsent tokens stay a liability, which is what makes deferred revenue honest.
 */
describeDb("token revenue recognition", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 4 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenants: string[] = [];

  const deps = {
    db: appDb,
    provider: new FakeProvider(),
    tokens: { hold: holdTokens, resolve: settleTokenHolds },
  };

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db
      .insert(accounts)
      .values({ id: id as TenantId, name: "Recog test", slug: `recog-${id}` });
    tenants.push(id);
    return id;
  }

  async function grantTokens(
    tenantId: string,
    quantity: bigint,
    unitPrice: bigint,
  ): Promise<void> {
    const reference = `token-${randomUUID()}`;
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      channel: "sms",
      quantity,
      unitPriceMinorLocked: unitPrice as MinorUnits,
      currency: "GHS",
      amountMinor: (quantity * unitPrice) as MinorUnits,
      email: "buyer@example.com",
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
      deliveryMode: "virtual",
    };
  }

  async function send(tenantId: string, body = "hello") {
    const input = inputFor(tenantId, body);
    return { input, prepared: await prepareSend(deps, input) };
  }

  /** Cached balance of a ledger account kind, which the write-time trigger maintains. */
  async function accountBalance(
    tenantId: string,
    kind: string,
  ): Promise<bigint> {
    const rows = (await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId}::uuid AND kind = ${kind} AND currency = 'GHS'`) as {
      balance_minor: string;
    }[];
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  }

  afterAll(async () => {
    for (const id of tenants) {
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
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("holds the whole purchase as a liability until anything is sent", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n); // 40 minor units of cash

    // Deferred revenue is a CREDIT balance, so it reads negative in the debit-positive projection.
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(40n);
    // Nothing delivered yet, so nothing is earned.
    expect(await accountBalance(tenant, "revenue")).toBe(0n);
  });

  it("recognizes revenue at the locked price when a send is delivered", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const { input, prepared } = await send(tenant);

    await dispatchSend(deps, input, prepared);

    // One segment consumed at the locked 4 → 4 earned, 36 still owed.
    expect(await accountBalance(tenant, "revenue")).toBe(4n);
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(36n);
  });

  it("recognizes per segment, since SMS spends a token per segment", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const { input, prepared } = await send(tenant, "x".repeat(200)); // 2 segments

    await dispatchSend(deps, input, prepared);

    expect(await accountBalance(tenant, "revenue")).toBe(8n);
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(32n);
  });

  it("recognizes each lot at ITS OWN locked price when a send spans lots", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 1n, 4n); // older, cheaper — 4 in
    await grantTokens(tenant, 5n, 9n); // newer, dearer — 45 in
    const { input, prepared } = await send(tenant, "x".repeat(200)); // 2 segments

    await dispatchSend(deps, input, prepared);

    // FIFO: 1 token from the 4-lot, 1 from the 9-lot. A single blended price would give 8 or 18 —
    // the price-lock is per lot, which is exactly what a token purchase buys.
    expect(await accountBalance(tenant, "revenue")).toBe(13n);
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(36n);
  });

  it("recognizes NOTHING when the send fails — we still owe the sends", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const { input, prepared } = await send(tenant);

    await failPreparedSend(deps, input, prepared, "test_failure");

    expect(await accountBalance(tenant, "revenue")).toBe(0n);
    // The liability stands in full: the tokens went back on the counter.
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(40n);
  });

  it("does not recognize twice when the delivery callback repeats", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const { input, prepared } = await send(tenant);
    await dispatchSend(deps, input, prepared);

    // A duplicate settle (retried callback) must transition nothing and recognize nothing.
    await appDb.withTenant(tenant, (tx) =>
      settleTokenHolds(tx, prepared.messageId, "committed"),
    );

    expect(await accountBalance(tenant, "revenue")).toBe(4n);
    expect(await accountBalance(tenant, "token_deferred_revenue")).toBe(36n);
  });

  it("keeps the ledger balanced — every recognition posts two equal legs", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n, 4n);
    const { input, prepared } = await send(tenant);
    await dispatchSend(deps, input, prepared);

    const rows = (await owner`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debits,
        COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credits
      FROM ledger_entries WHERE tenant_id = ${tenant}::uuid`) as {
      debits: string;
      credits: string;
    }[];
    // The trial balance across purchase + consumption.
    expect(rows[0]?.debits).toBe(rows[0]?.credits);
  });
});

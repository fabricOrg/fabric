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
  sweepExpired,
} from "@app/sms-engine";
import { credit } from "@app/wallet";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { grantTokensForPurchase, readTokenBalance } from "./token-grant.js";
import { holdTokens, resolveTokenHolds } from "./token-holds.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for ADR-0010 §8 send-path resolution order (slice 2b-ii):
 * price book → TOKENS first → wallet money → reject.
 *
 * The invariant under test is EXCLUSIVITY: a send is token-backed XOR wallet-backed, and settles on
 * exactly the layer it was accepted under. A send that consumed both would charge twice.
 */
describeDb("send path: tokens first, then wallet", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 4 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenants: string[] = [];

  const deps = {
    db: appDb,
    provider: new FakeProvider(),
    tokens: { hold: holdTokens, resolve: resolveTokenHolds },
  };

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db
      .insert(accounts)
      .values({ id: id as TenantId, name: "Send test", slug: `send-${id}` });
    tenants.push(id);
    return id;
  }

  async function fundWallet(tenantId: string, amount: bigint): Promise<void> {
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: amount,
        idempotencyKey: `topup-${randomUUID()}`,
      }),
    );
  }

  async function grantTokens(
    tenantId: string,
    quantity: bigint,
  ): Promise<void> {
    const reference = `token-${randomUUID()}`;
    await provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      channel: "sms",
      quantity,
      unitPriceMinorLocked: 4n as MinorUnits,
      currency: "GHS",
      amountMinor: (quantity * 4n) as MinorUnits,
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
      // LIVE, deliberately. This suite exists to prove tokens-XOR-wallet, and since sandbox
      // allowances landed a `virtual` send claims neither — it draws on the daily allowance and
      // returns before either layer is touched. Running it virtual would pass while asserting
      // nothing about the invariant. The carrier is still FakeProvider, so nothing leaves.
      deliveryMode: "live",
    };
  }

  async function send(tenantId: string, body = "hello") {
    const input = inputFor(tenantId, body);
    return { input, prepared: await prepareSend(deps, input) };
  }

  const walletBalance = async (tenantId: string): Promise<bigint> => {
    const rows = (await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId}::uuid AND kind = 'customer' AND currency = 'GHS'`) as {
      balance_minor: string;
    }[];
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  };

  const tokenBalance = (tenantId: string) =>
    appDb.withTenant(tenantId, (tx) => readTokenBalance(tx, "sms", "GHS"));

  const backingOf = async (messageId: string): Promise<string> => {
    const rows = (await owner`
      SELECT backing FROM messages WHERE id = ${messageId}::uuid`) as {
      backing: string;
    }[];
    return String(rows[0]?.backing);
  };

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
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("spends tokens and leaves the wallet untouched when tokens are available", async () => {
    const tenant = await makeTenant();
    await fundWallet(tenant, 1_000n);
    await grantTokens(tenant, 10n);

    const { prepared } = await send(tenant);

    expect(await backingOf(prepared.messageId)).toBe("tokens");
    expect(await tokenBalance(tenant)).toBe(9n);
    // The money wallet must not have moved at all — no reserve, no balance change.
    expect(await walletBalance(tenant)).toBe(1_000n);
  });

  it("falls through to the wallet when the tenant holds no tokens", async () => {
    const tenant = await makeTenant();
    await fundWallet(tenant, 1_000n);

    const { prepared } = await send(tenant);

    expect(await backingOf(prepared.messageId)).toBe("wallet");
    // One segment at the default GHS rate (3) is reserved off the balance.
    expect(await walletBalance(tenant)).toBe(997n);
  });

  it("falls through to the wallet when tokens exist but cannot cover the segments", async () => {
    const tenant = await makeTenant();
    await fundWallet(tenant, 1_000n);
    await grantTokens(tenant, 1n);

    // Long enough to need more than one segment, so a single token cannot cover it.
    const { prepared } = await send(tenant, "x".repeat(200));

    expect(await backingOf(prepared.messageId)).toBe("wallet");
    // All-or-nothing: the one token stays put rather than part-paying.
    expect(await tokenBalance(tenant)).toBe(1n);
    expect(await walletBalance(tenant)).toBeLessThan(1_000n);
  });

  it("charges tokens PER SEGMENT, matching the SMS pricing basis", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n);

    const { prepared } = await send(tenant, "x".repeat(200)); // 2 segments

    expect(prepared.segments).toBe(2);
    expect(await backingOf(prepared.messageId)).toBe("tokens");
    expect(await tokenBalance(tenant)).toBe(8n);
  });

  it("commits token holds on delivery without touching the ledger", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n);
    const { input, prepared } = await send(tenant);

    await dispatchSend(deps, input, prepared);

    // Tokens were spent at hold time; committing must not move the counter again.
    expect(await tokenBalance(tenant)).toBe(9n);
    const ledgerRows = (await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenant}::uuid AND reference_id = ${prepared.messageId}::uuid`) as {
      n: number;
    }[];
    // A token-backed send never reserved money, so it must post NO ledger legs at all.
    expect(ledgerRows[0]?.n).toBe(0);
  });

  it("returns token holds when the send fails", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n);
    const { input, prepared } = await send(tenant, "x".repeat(200)); // 2 segments held
    expect(await tokenBalance(tenant)).toBe(8n);

    await failPreparedSend(deps, input, prepared, "test_failure");

    expect(await tokenBalance(tenant)).toBe(10n);
  });

  it("keeps a wallet-backed send settling on money, with tokens untouched", async () => {
    const tenant = await makeTenant();
    await fundWallet(tenant, 1_000n);
    const { input, prepared } = await send(tenant); // no tokens yet → wallet
    expect(await backingOf(prepared.messageId)).toBe("wallet");

    // Tokens arrive AFTER acceptance; the in-flight send must still settle on money.
    await grantTokens(tenant, 10n);
    await dispatchSend(deps, input, prepared);

    expect(await tokenBalance(tenant)).toBe(10n);
    // Committed: the reserve already debited the balance, and commit recognizes it as revenue.
    expect(await walletBalance(tenant)).toBe(997n);
  });

  it("returns token holds when the reservation sweeper expires a stuck send", async () => {
    const tenant = await makeTenant();
    await grantTokens(tenant, 10n);
    const { prepared } = await send(tenant, "x".repeat(200)); // 2 segments held
    expect(await tokenBalance(tenant)).toBe(8n);

    // Crash between accept and provider outcome: the message sits non-terminal until the sweeper
    // resolves it. The sweeper shares resolveMessage, so a token-backed send must return TOKENS
    // here, not attempt a wallet refund it never reserved.
    const swept = await sweepExpired(
      deps,
      tenant,
      new Date(Date.now() + 60_000).toISOString(),
    );

    expect(swept).toBeGreaterThan(0);
    expect(await tokenBalance(tenant)).toBe(10n);
    expect(await backingOf(prepared.messageId)).toBe("tokens");
  });

  it("never double-charges when the same message id is retried", async () => {
    const tenant = await makeTenant();
    await fundWallet(tenant, 1_000n);
    await grantTokens(tenant, 10n);
    const messageId = randomUUID();

    const first = await prepareSend(deps, {
      tenantId: tenant,
      messageId,
      to: "+233200000001",
      senderId: "FABRIC",
      body: "hello",
      currency: "GHS",
      deliveryMode: "live",
    });
    const retry = await prepareSend(deps, {
      tenantId: tenant,
      messageId,
      to: "+233200000001",
      senderId: "FABRIC",
      body: "hello",
      currency: "GHS",
      deliveryMode: "live",
    });

    expect(retry.messageId).toBe(first.messageId);
    expect(await backingOf(messageId)).toBe("tokens");
    // The retry must not claim a second token NOR reserve money as a second backing.
    expect(await tokenBalance(tenant)).toBe(9n);
    expect(await walletBalance(tenant)).toBe(1_000n);
  });
});

import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type MinorUnits,
  priceBookRates,
  priceBooks,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { readTokenBalance } from "./token-grant.js";
import { TokenPurchaseService } from "./token-purchase.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

/**
 * Real-Postgres coverage for token purchase (ADR-0010 slice 2c-iii). The security property under
 * test: the price and the granted quantity come from SERVER state — the token price book at initiate,
 * and the stored intent at grant — never from the caller or the webhook payload.
 */
class FakeCheckout {
  initCharge(params: { reference: string }) {
    return Promise.resolve({
      authorizationUrl: `https://checkout.paystack.test/${params.reference}`,
      providerRef: `ref_${params.reference}`,
    });
  }
}

describeDb("token purchase", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 2 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenants: string[] = [];
  const books: string[] = [];

  const config = {
    get: (key: string) =>
      key === "PAYSTACK_SECRET_KEY" ? "sk_test_dummy" : undefined,
  } as unknown as ConfigService;
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  const service = new TokenPurchaseService(
    provisioning,
    appDb,
    config,
    killSwitch,
  );
  // Swap the real Paystack client for a stub — no network in tests. Mirrors the payments/flows specs;
  // readonly at compile-time only. The WEBHOOK half is driven directly via completeFromWebhook, which
  // is the code the signature-verified controller calls.
  (service as unknown as { provider: FakeCheckout }).provider =
    new FakeCheckout();

  async function makeTenant(): Promise<string> {
    const id = randomUUID();
    await provisioning.db
      .insert(accounts)
      .values({ id: id as TenantId, name: "Buy test", slug: `buy-${id}` });
    tenants.push(id);
    return id;
  }

  /**
   * The DEFAULT token price book initiate resolves from. Created ONCE and reused: the partial index
   * `uniq_default_price_book_per_mode` permits exactly one default per mode, so a per-test book would
   * collide. Scoped to the token mode, so the subscription default other specs read is undisturbed.
   */
  let tokenBookId: string | null = null;
  async function ensureTokenBook(unitPrice: bigint): Promise<void> {
    if (tokenBookId) return;
    const [book] = await provisioning.db
      .insert(priceBooks)
      .values({
        name: `Token — ${randomUUID()}`,
        mode: "token",
        isDefault: true,
      })
      .returning({ id: priceBooks.id });
    tokenBookId = book?.id ?? "";
    books.push(tokenBookId);
    await provisioning.db.insert(priceBookRates).values({
      priceBookId: tokenBookId,
      channel: "sms",
      currency: "GHS",
      unitPriceMinor: unitPrice as MinorUnits,
    });
  }

  afterAll(async () => {
    for (const id of tenants) {
      await owner`DELETE FROM token_holds WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_lots WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_counters WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM token_purchases WHERE tenant_id = ${id}::uuid`;
      await owner`DELETE FROM accounts WHERE id = ${id}::uuid`;
    }
    for (const id of books) {
      await owner`DELETE FROM price_book_rates WHERE price_book_id = ${id}::uuid`;
      await owner`DELETE FROM price_books WHERE id = ${id}::uuid`;
    }
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  // MUST run first: it asserts the state before any default token book exists in this file.
  it("refuses to sell when no token price book is configured", async () => {
    const tenant = await makeTenant();
    // No seeded default token book exists by design — inventing a token price would be a fabricated
    // rate (ADR-0010 §11). Selling must fail closed until staff configure one.
    await expect(
      service.initiate(tenant, {
        channel: "sms",
        quantity: 100,
        currency: "GHS",
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "token_price_unavailable" } },
    });

    const rows = (await owner`
      SELECT count(*)::int AS n FROM token_purchases
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    // Nothing recorded — a refused sale leaves no intent behind.
    expect(rows[0]?.n).toBe(0);
  });

  it("grants only after the webhook confirms, at the price the SERVER set", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n);

    const quote = await service.initiate(tenant, {
      channel: "sms",
      quantity: 100,
      currency: "GHS",
      email: "buyer@example.com",
    });
    // The price came from the book, not the caller: 100 × 7.
    expect(quote.unit_price_minor).toBe("7");
    expect(quote.amount_minor).toBe("700");
    expect(quote.reference.startsWith("token-")).toBe(true);
    // Nothing is owned until the money clears.
    expect(
      await appDb.withTenant(tenant, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(0n);

    await service.completeFromWebhook(quote.reference, {
      amountMinor: 700n,
      currency: "GHS",
    });

    expect(
      await appDb.withTenant(tenant, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(100n);
    const [row] = await provisioning.db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.reference, quote.reference));
    expect(row?.status).toBe("success");
  });

  it("refuses a webhook whose amount disagrees with the stored intent", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n);
    const quote = await service.initiate(tenant, {
      channel: "sms",
      quantity: 100,
      currency: "GHS",
      email: "buyer@example.com",
    });

    // A forged/tampered callback claiming a smaller payment must not mint the entitlement.
    await service.completeFromWebhook(quote.reference, {
      amountMinor: 1n,
      currency: "GHS",
    });

    expect(
      await appDb.withTenant(tenant, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(0n);
    const [row] = await provisioning.db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.reference, quote.reference));
    expect(row?.status).toBe("failed");
  });

  it("grants exactly once when the webhook is replayed", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n);
    const quote = await service.initiate(tenant, {
      channel: "sms",
      quantity: 10,
      currency: "GHS",
      email: "buyer@example.com",
    });

    const event = { amountMinor: 70n, currency: "GHS" };
    await service.completeFromWebhook(quote.reference, event);
    await service.completeFromWebhook(quote.reference, event);
    await service.completeFromWebhook(quote.reference, event);

    expect(
      await appDb.withTenant(tenant, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(10n);
    const lots = (await owner`
      SELECT count(*)::int AS n FROM token_lots
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    expect(lots[0]?.n).toBe(1);
  });

  it("refuses a charge too large to represent exactly, before taking money", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n);
    // Push the total past 2^53 via a deliberately absurd configured price. The provider coerces the
    // amount through Number(), so a rounded charge would later mismatch the stored intent and strand
    // the buyer: charged, no tokens. The sale must stop first.
    await owner`
      UPDATE price_book_rates SET unit_price_minor = 9007199254740993
      WHERE price_book_id = ${tokenBookId}::uuid AND channel = 'sms' AND currency = 'GHS'`;

    await expect(
      service.initiate(tenant, {
        channel: "sms",
        quantity: 1000,
        currency: "GHS",
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "token_amount_too_large" } },
    });

    const rows = (await owner`
      SELECT count(*)::int AS n FROM token_purchases
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    // No intent written — nothing to reconcile against later.
    expect(rows[0]?.n).toBe(0);

    await owner`
      UPDATE price_book_rates SET unit_price_minor = 7
      WHERE price_book_id = ${tokenBookId}::uuid AND channel = 'sms' AND currency = 'GHS'`;
  });

  it("refuses to sell EMAIL tokens, which no send path can spend", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n);

    // Only the sms engine holds/settles tokens; the email accept path still reserves from the
    // wallet. Selling an email token would take money for an entitlement that can never be
    // consumed — an undischargeable liability, and the customer pays twice.
    await expect(
      service.initiate(tenant, {
        channel: "email",
        quantity: 100,
        currency: "GHS",
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "token_channel_unavailable" } },
    });

    // No intent, so no webhook can later grant against it.
    const rows = (await owner`
      SELECT count(*)::int AS n FROM token_purchases
      WHERE tenant_id = ${tenant}::uuid`) as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it("refuses a currency the token book does not price", async () => {
    const tenant = await makeTenant();
    await ensureTokenBook(7n); // GHS only

    await expect(
      service.initiate(tenant, {
        channel: "sms",
        quantity: 5,
        currency: "NGN",
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "token_price_unavailable" } },
    });
  });
});

import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { TokenCatalogService } from "./token-catalog.service.js";
import { readTokenBalance } from "./token-grant.js";
import { seedPublishedOffer } from "./token-purchase.fixtures.js";
import { TokenPurchaseService } from "./token-purchase.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

class FakeCheckout {
  initCharge(params: { reference: string }) {
    return Promise.resolve({
      authorizationUrl: `https://checkout.paystack.test/${params.reference}`,
      providerRef: `ref_${params.reference}`,
    });
  }
}

describeDb("commercial-offer token purchase", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 2 });
  const owner = postgres(superUrl ?? "", { max: 1 });
  const tenantIds: string[] = [];
  const bookIds: string[] = [];
  const offerIds: string[] = [];
  const staffIds: string[] = [];

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
    {
      resolvePayment: async () => ({
        provider: new FakeCheckout(),
        creds: { secretKey: "sk_test_dummy" },
        instanceId: null,
        credentialVersion: 1,
      }),
    } as unknown as PluginResolverService,
  );
  const catalogService = new TokenCatalogService(provisioning);

  async function makeTenant(
    currency: "GHS" | "NGN" = "GHS",
    plan: "free" | "sandbox" = "free",
  ) {
    const id = randomUUID();
    await provisioning.db.insert(accounts).values({
      id: id as TenantId,
      name: "Bundle buyer",
      slug: `bundle-${id}`,
      billingCurrency: currency,
      plan,
    });
    tenantIds.push(id);
    return id;
  }

  const makePublishedOffer = (
    tenantId: string,
    terms: Parameters<typeof seedPublishedOffer>[3] = {},
  ) =>
    seedPublishedOffer(
      provisioning,
      { bookIds, offerIds, staffIds },
      tenantId,
      terms,
    );

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await owner`DELETE FROM token_recognition_allocations WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_holds WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_lots WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_counters WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM token_purchases WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM offer_catalog_assignments WHERE tenant_id = ${tenantId}::uuid`;
      await owner`DELETE FROM accounts WHERE id = ${tenantId}::uuid`;
    }
    for (const offerId of offerIds) {
      // Items first: the FK to the version is ON DELETE RESTRICT.
      await owner`
        DELETE FROM pricing_offer_version_items
        WHERE offer_version_id IN (
          SELECT id FROM pricing_offer_versions WHERE offer_id = ${offerId}::uuid
        )`;
      await owner`DELETE FROM pricing_offer_versions WHERE offer_id = ${offerId}::uuid`;
      await owner`DELETE FROM pricing_offers WHERE id = ${offerId}::uuid`;
    }
    for (const bookId of bookIds) {
      await owner`DELETE FROM price_books WHERE id = ${bookId}::uuid`;
    }
    for (const staffId of staffIds) {
      await owner`DELETE FROM staff_users WHERE id = ${staffId}::uuid`;
    }
    await owner.end();
    await provisioning.end();
    await appDb.sql.end();
  });

  it("snapshots exact fixed-total terms and grants only after matching payment", async () => {
    const tenantId = await makeTenant();
    const versionId = await makePublishedOffer(tenantId);
    const checkout = await service.initiate(tenantId, {
      offer_version_id: versionId,
      pack_count: 2,
      email: "buyer@example.com",
    });

    expect(checkout).toMatchObject({
      offer_version_id: versionId,
      pack_count: 2,
      // 2 packs × the 200-segment item; quantity is per item now, not one number on the package.
      items: [{ channel_code: "sms", unit_code: "segment", quantity: "400" }],
      amount_minor: "600",
      currency: "GHS",
    });
    expect(
      await appDb.withTenant(tenantId, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(0n);

    await service.completeFromWebhook(checkout.reference, {
      amountMinor: 600n,
      currency: "GHS",
      verifiedMode: "live",
    });
    expect(
      await appDb.withTenant(tenantId, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(400n);
    const [purchase] = await provisioning.db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.reference, checkout.reference));
    expect(purchase).toMatchObject({
      offerVersionId: versionId,
      packCount: 2,
      amountMinor: 600n,
      status: "success",
    });
  });

  it("reconciles webhook amount and grants exactly once on replay", async () => {
    const tenantId = await makeTenant();
    const versionId = await makePublishedOffer(tenantId);
    const rejected = await service.initiate(tenantId, {
      offer_version_id: versionId,
      pack_count: 1,
      email: "buyer@example.com",
    });
    await service.completeFromWebhook(rejected.reference, {
      amountMinor: 299n,
      currency: "GHS",
      verifiedMode: "live",
    });
    expect(
      await appDb.withTenant(tenantId, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(0n);

    const accepted = await service.initiate(tenantId, {
      offer_version_id: versionId,
      pack_count: 1,
      email: "buyer@example.com",
    });
    const event = {
      amountMinor: 300n,
      currency: "GHS",
      verifiedMode: "live" as const,
    };
    await Promise.all([
      service.completeFromWebhook(accepted.reference, event),
      service.completeFromWebhook(accepted.reference, event),
    ]);
    expect(
      await appDb.withTenant(tenantId, (tx) =>
        readTokenBalance(tx, "sms", "GHS"),
      ),
    ).toBe(200n);
    const lots = (await owner`
      SELECT count(*)::int AS count FROM token_lots
      WHERE tenant_id = ${tenantId}::uuid`) as { count: number }[];
    expect(lots[0]?.count).toBe(1);
  });

  it("fails closed on catalog, currency, and pack-count mismatches", async () => {
    const noCatalogTenant = await makeTenant();
    await expect(
      service.initiate(noCatalogTenant, {
        offer_version_id: randomUUID(),
        pack_count: 1,
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "offer_catalog_unavailable" } },
    });

    const ngnTenant = await makeTenant("NGN");
    const versionId = await makePublishedOffer(ngnTenant, {
      minimum: 2,
      maximum: 4,
    });
    await expect(
      service.initiate(ngnTenant, {
        offer_version_id: versionId,
        pack_count: 1,
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "commercial_offer_currency_mismatch" } },
    });
  });

  it("never creates a paid token purchase for a sandbox workspace", async () => {
    const tenantId = await makeTenant("GHS", "sandbox");
    const versionId = await makePublishedOffer(tenantId);
    await expect(
      service.initiate(tenantId, {
        offer_version_id: versionId,
        pack_count: 1,
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "sandbox_token_purchase_denied" } },
    });
  });

  it("does not sell an offer whose service-class restriction cannot be consumed yet", async () => {
    const tenantId = await makeTenant();
    const versionId = await makePublishedOffer(tenantId, {
      serviceClasses: ["priority"],
    });
    expect((await catalogService.catalog(tenantId)).offers).toEqual([]);
    await expect(
      service.initiate(tenantId, {
        offer_version_id: versionId,
        pack_count: 1,
        email: "buyer@example.com",
      }),
    ).rejects.toMatchObject({
      response: {
        error: { code: "commercial_offer_consumption_unavailable" },
      },
    });
  });
});

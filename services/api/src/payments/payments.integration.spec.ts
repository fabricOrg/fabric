import { createHmac, randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  payments,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { TokenPurchaseService } from "../tokens/token-purchase.service.js";
import { AutoTopupService } from "./auto-topup.service.js";
import { PaymentsService } from "./payments.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

const SECRET = "sk_test_paystack_example_key_1234567890";

function sign(body: string): string {
  return createHmac("sha512", SECRET).update(body, "utf8").digest("hex");
}

describeDb("wallet top-up (Paystack)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "");
  // Raw superuser connection for teardown: the ledger is append-only (app_runtime can't DELETE), so
  // the test-only superuser bypasses the REVOKE + RLS to clean up — same pattern as the wallet spec.
  const owner = postgres(superUrl ?? "", { max: 1 });
  const config = {
    get: (key: string) =>
      key === "PAYSTACK_SECRET_KEY"
        ? SECRET
        : key === "DASHBOARD_BASE_URL"
          ? "https://app.fabric.dev"
          : undefined,
  } as unknown as ConfigService;
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  const service = new PaymentsService(
    provisioning,
    appDb,
    config,
    killSwitch,
    new TokenPurchaseService(provisioning, appDb, config, killSwitch),
  );
  const autoTopupService = new AutoTopupService(
    provisioning,
    appDb,
    config,
    killSwitch,
  );

  const tenantId = randomUUID() as TenantId;

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Topup Test",
      slug: `topup-${tenantId}`,
    });
  });

  afterAll(async () => {
    await provisioning.db
      .delete(payments)
      .where(eq(payments.tenantId, tenantId));
    // Owner bypasses the append-only REVOKE + RLS (test teardown only).
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM payment_authorizations WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM auto_topup WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  // A top-up in the wrong currency settles into a ledger account nothing can spend, and there is no
  // refund path — so it must fail BEFORE the charge. No fetch is mocked here, so removing the guard
  // fails this on a real network call rather than letting it pass vacuously.
  it("refuses a top-up in a currency the workspace is not billed in", async () => {
    await expect(
      service.initiate(tenantId, {
        amount_minor: "5000",
        currency: "USD",
        email: "payer@example.com",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "billing_currency_mismatch" } },
    });

    const rows = await provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.tenantId, tenantId));
    expect(rows).toHaveLength(0);
  });

  it("initiate creates a pending intent and returns the checkout URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/xyz",
            access_code: "ac_xyz",
            reference: "ignored",
          },
        }),
        { status: 200 },
      ),
    );

    const result = await service.initiate(tenantId, {
      amount_minor: "5000",
      currency: "GHS",
      email: "payer@example.com",
    });
    expect(result.authorization_url).toBe("https://checkout.paystack.com/xyz");
    expect(result.reference).toMatch(/^topup-/);

    const [row] = await provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.reference, result.reference));
    expect(row).toMatchObject({ status: "pending", currency: "GHS" });
    expect(row?.amountMinor).toBe(5000n);
    vi.restoreAllMocks();
  });

  it("credits the wallet once on charge.success, and is idempotent on replay", async () => {
    const reference = `topup-${randomUUID()}`;
    await provisioning.db.insert(payments).values({
      tenantId,
      reference,
      amountMinor: 5000n as never,
      currency: "GHS",
      email: "payer@example.com",
      status: "pending",
    });
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        reference,
        amount: 5000,
        currency: "GHS",
        status: "success",
        authorization: {
          authorization_code: "AUTH_test123",
          card_type: "visa",
          last4: "4081",
          exp_month: "12",
          exp_year: "2030",
          reusable: true,
        },
      },
    });

    await service.handleWebhook(Buffer.from(body), sign(body));
    // Replay — must NOT double-credit.
    await service.handleWebhook(Buffer.from(body), sign(body));

    // The reusable card authorization was captured (powers the Payment-method card + auto top-up).
    const saved = await service.getSavedMethod(tenantId);
    expect(saved.method).toMatchObject({
      brand: "visa",
      last4: "4081",
      exp: "12/2030",
    });

    const [row] = await provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.reference, reference));
    expect(row?.status).toBe("success");

    const balance = await appDb.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        SELECT balance_minor FROM ledger_accounts
        WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'
      `) as { balance_minor: string }[];
      return rows[0]?.balance_minor ?? "0";
    });
    expect(BigInt(balance)).toBe(5000n); // credited once, not 10000
  });

  it("rejects a webhook with a bad signature", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "topup-x" },
    });
    await expect(
      service.handleWebhook(Buffer.from(body), "bad-signature"),
    ).rejects.toMatchObject({
      response: { error: { code: "invalid_signature" } },
    });
  });

  it("marks the intent failed on an amount mismatch", async () => {
    const reference = `topup-${randomUUID()}`;
    await provisioning.db.insert(payments).values({
      tenantId,
      reference,
      amountMinor: 5000n as never,
      currency: "GHS",
      email: "payer@example.com",
      status: "pending",
    });
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference, amount: 9999, currency: "GHS", status: "success" },
    });
    await service.handleWebhook(Buffer.from(body), sign(body));

    const [row] = await provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.reference, reference));
    expect(row?.status).toBe("failed");
  });

  // ---- Auto top-up ------------------------------------------------------------------------------
  // These run AFTER the charge.success test above, so `tenantId` now has a reusable card on file and
  // a 5000 GHS balance — the preconditions auto top-up needs.

  it("refuses to enable auto top-up without a saved card", async () => {
    const noCard = randomUUID() as TenantId;
    await provisioning.db.insert(accounts).values({
      id: noCard,
      name: "No Card",
      slug: `nocard-${noCard}`,
    });
    await expect(
      autoTopupService.updateAutoTopup(noCard, {
        enabled: true,
        threshold_minor: "1000",
        top_up_minor: "5000",
        currency: "GHS",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "no_saved_card" } } });
    await owner`DELETE FROM accounts WHERE id = ${noCard}`;
  });

  it("persists and reads back the auto top-up config (card on file)", async () => {
    const saved = await autoTopupService.updateAutoTopup(tenantId, {
      enabled: true,
      threshold_minor: "1000000", // 5000 balance ≤ threshold → the next check will charge
      top_up_minor: "5000",
      currency: "GHS",
    });
    expect(saved).toMatchObject({
      has_card: true,
      config: {
        enabled: true,
        threshold_minor: "1000000",
        top_up_minor: "5000",
        currency: "GHS",
      },
    });
    const got = await autoTopupService.getAutoTopup(tenantId);
    expect(got.config?.enabled).toBe(true);
  });

  it("charges the saved card when balance is at/below the threshold", async () => {
    // Clear the stray pending intent left by the `initiate` test so the in-flight guard doesn't block.
    await provisioning.db
      .delete(payments)
      .where(
        and(eq(payments.tenantId, tenantId), eq(payments.status, "pending")),
      );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: { status: "success", id: 90210 },
        }),
        { status: 200 },
      ),
    );
    await autoTopupService.maybeAutoTopUp(tenantId);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/transaction/charge_authorization"),
      expect.anything(),
    );
    // A fresh pending intent for the top-up amount was created; the webhook credits it later.
    const [pending] = await provisioning.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.tenantId, tenantId), eq(payments.status, "pending")),
      );
    expect(pending?.amountMinor).toBe(5000n);
    expect(pending?.providerRef).toBe("90210");
    vi.restoreAllMocks();
  });

  it("does not charge again while an intent is in flight", async () => {
    // The prior test left a pending intent → the in-flight guard must block a second charge.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await autoTopupService.maybeAutoTopUp(tenantId);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does nothing when auto top-up is disabled", async () => {
    await autoTopupService.updateAutoTopup(tenantId, {
      enabled: false,
      threshold_minor: "1000000",
      top_up_minor: "5000",
      currency: "GHS",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await autoTopupService.maybeAutoTopUp(tenantId);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // Disable is deliberately NOT currency-guarded: a caller turning off an already-mismatched config
  // sends the STORED currency, so guarding it would leave a config that nothing can charge and
  // nothing can clear. Pinned because hoisting the guard out of the enable block would restore that
  // trap. Last in the file because it leaves auto top-up disabled.
  it("lets a mismatched auto top-up be turned OFF, but not turned on", async () => {
    await expect(
      autoTopupService.updateAutoTopup(tenantId, {
        enabled: false,
        threshold_minor: "1000",
        top_up_minor: "5000",
        currency: "USD",
      }),
    ).resolves.toMatchObject({ config: { enabled: false } });

    await expect(
      autoTopupService.updateAutoTopup(tenantId, {
        enabled: true,
        threshold_minor: "1000",
        top_up_minor: "5000",
        currency: "USD",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "billing_currency_mismatch" } },
    });
  });
});

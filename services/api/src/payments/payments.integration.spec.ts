import { createHmac, randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  payments,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
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
  const service = new PaymentsService(provisioning, appDb, config, killSwitch);

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
    await appDb.withTenant(tenantId, async (tx) => {
      await tx`DELETE FROM ledger_entries WHERE account_id IN (SELECT id FROM ledger_accounts WHERE tenant_id = ${tenantId})`;
      await tx`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
      await tx`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    });
    await provisioning.db.delete(accounts).where(eq(accounts.id, tenantId));
    await provisioning.end();
    await appDb.end();
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
    expect(result.reference).toMatch(/^topup:/);

    const [row] = await provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.reference, result.reference));
    expect(row).toMatchObject({ status: "pending", currency: "GHS" });
    expect(row?.amountMinor).toBe(5000n);
    vi.restoreAllMocks();
  });

  it("credits the wallet once on charge.success, and is idempotent on replay", async () => {
    const reference = `topup:${randomUUID()}`;
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
      data: { reference, amount: 5000, currency: "GHS", status: "success" },
    });

    await service.handleWebhook(Buffer.from(body), sign(body));
    // Replay — must NOT double-credit.
    await service.handleWebhook(Buffer.from(body), sign(body));

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
      data: { reference: "topup:x" },
    });
    await expect(
      service.handleWebhook(Buffer.from(body), "bad-signature"),
    ).rejects.toMatchObject({
      response: { error: { code: "invalid_signature" } },
    });
  });

  it("marks the intent failed on an amount mismatch", async () => {
    const reference = `topup:${randomUUID()}`;
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
});

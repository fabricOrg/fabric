import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import type { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { TokenPurchaseService } from "../tokens/token-purchase.service.js";
import { FlowsService } from "./flows.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

async function customerBalance(
  appDb: ReturnType<typeof createAppDb>,
  tenantId: TenantId,
): Promise<bigint> {
  return appDb.withTenant(tenantId, async (tx) => {
    const rows = (await tx`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'
    `) as { balance_minor: string }[];
    return BigInt(rows[0]?.balance_minor ?? "0");
  });
}

/**
 * Fake Paystack provider: no network. initCharge records the reference it was handed (so the test can
 * fire the matching webhook); verifyWebhook always passes; parseEvent parses our hand-built JSON.
 */
class FakeProvider {
  lastReference: string | null = null;
  initCharge(params: { reference: string }) {
    this.lastReference = params.reference;
    return Promise.resolve({
      authorizationUrl: `https://checkout.paystack.test/${params.reference}`,
      providerRef: `ref_${params.reference}`,
    });
  }
  verifyWebhook() {
    return true;
  }
  parseEvent(raw: string) {
    const e = JSON.parse(raw) as {
      reference: string;
      amountMinor: string;
      currency: string;
    };
    return {
      status: "success" as const,
      reference: e.reference,
      amountMinor: BigInt(e.amountMinor),
      currency: e.currency,
    };
  }
}

describeDb("flows (Lighthouse saga)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "");
  // Raw superuser for teardown: the ledger is append-only for app_runtime (same as the wallet spec).
  const owner = postgres(superUrl ?? "", { max: 1 });
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  const config = {
    get: (key: string) =>
      key === "PAYSTACK_SECRET_KEY" ? "sk_test_dummy" : undefined,
  } as unknown as ConfigService;
  const fakeProvider = new FakeProvider();
  /**
   * Inject the fake through the RESOLVER (ADR-0011), which is how the processor is chosen now. This
   * used to overwrite a private `provider` field on the service; that field is gone, and swapping it
   * silently stopped working — the service resolved the real Paystack client and made a live network
   * call. Stubbing the seam the code actually uses keeps the test honest about that.
   */
  // instanceId must be a real UUID: it is persisted to payments.plugin_instance_id (uuid), which is
  // how a webhook is later bound to the credential that created the charge.
  const fakeInstanceId = randomUUID();
  const resolver = {
    resolvePayment: async () => ({
      vendor: "paystack",
      instanceId: fakeInstanceId,
      provider: fakeProvider,
      creds: { secretKey: "sk_test_dummy" },
      credentialVersion: 1,
    }),
    // The webhook path verifies against these rather than the resolved-for-charge credential.
    paymentWebhookCredentials: async () => [
      {
        mode: "live" as const,
        instanceId: fakeInstanceId,
        version: 1,
        provider: fakeProvider,
        creds: { secretKey: "sk_test_dummy" },
      },
    ],
  } as unknown as PluginResolverService;
  const payments = new PaymentsService(
    provisioning,
    appDb,
    config,
    killSwitch,
    new TokenPurchaseService(provisioning, appDb, config, killSwitch),
    resolver,
  );
  const service = new FlowsService(appDb, killSwitch, payments);
  const tenantId = randomUUID() as TenantId;

  /** Fire the charge.success webhook for a reference through the real handler. */
  async function fireWebhook(reference: string, amountMinor: string) {
    const body = Buffer.from(
      JSON.stringify({ reference, amountMinor, currency: "GHS" }),
    );
    await payments.handleWebhook(body, "sig");
  }

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Flows Test",
      slug: `flows-${tenantId}`,
    });
  });

  afterAll(async () => {
    await owner`DELETE FROM payments WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM flow_records WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  it("confirm starts a collection (charge pending, no credit); the webhook credits once + completes the flow, and both replay idempotently", async () => {
    const started = await service.start(tenantId, {
      action: "start",
      msisdn: "+233544000001",
      currency: "GHS",
      minor: "5000",
      channel: "sms",
    });
    expect(started.correlationId).toMatch(/^corr_/);

    // Verify → collection initiated. No money moves yet; we hand back the hosted-checkout URL.
    const confirmed = await service.confirm(tenantId, {
      action: "confirm",
      correlationId: started.correlationId,
      code: "123456",
    });
    expect(confirmed.authorizationUrl).toMatch(/^https:\/\/checkout/);
    expect(confirmed.record.verify.status).toBe("done");
    expect(confirmed.record.charge.status).toBe("pending");
    expect(await customerBalance(appDb, tenantId)).toBe(0n);
    const reference = fakeProvider.lastReference;
    expect(reference).toMatch(/^flow-/);

    // Webhook clears the payment → credits the wallet + completes the flow.
    await fireWebhook(reference ?? "", "5000");
    expect(await customerBalance(appDb, tenantId)).toBe(5000n);

    const feed = await service.list(tenantId);
    const record = feed.transactions.find(
      (t) => t.correlationId === started.correlationId,
    );
    expect(record?.charge.status).toBe("done");
    expect(record?.notify.status).toBe("done");
    expect(record?.amount.minor).toBe("5000");
    const totalVolume = feed.series.reduce(
      (sum, p) => sum + BigInt(p.volumeMinor),
      0n,
    );
    expect(totalVolume).toBe(5000n);

    // Replay confirm: collection already started (charge_reference set) → no second checkout, no credit.
    const again = await service.confirm(tenantId, {
      action: "confirm",
      correlationId: started.correlationId,
      code: "123456",
    });
    expect(again.authorizationUrl).toBeNull();
    expect(await customerBalance(appDb, tenantId)).toBe(5000n);

    // Replay webhook: payment already success → no double credit.
    await fireWebhook(reference ?? "", "5000");
    expect(await customerBalance(appDb, tenantId)).toBe(5000n);
  });

  it("rejects a wrong OTP without starting a collection", async () => {
    const started = await service.start(tenantId, {
      action: "start",
      msisdn: "+233544000002",
      currency: "GHS",
      minor: "3000",
      channel: "sms",
    });
    const before = await customerBalance(appDb, tenantId);
    await expect(
      service.confirm(tenantId, {
        action: "confirm",
        correlationId: started.correlationId,
        code: "000000",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "otp_invalid" } } });
    expect(await customerBalance(appDb, tenantId)).toBe(before);
  });
});

import { randomUUID } from "node:crypto";
import {
  accounts,
  autoTopup,
  createAppDb,
  createProvisioningDb,
  ledgerAccounts,
  type MinorUnits,
  paymentAuthorizations,
  payments,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { AutoTopupService } from "./auto-topup.service.js";

// Pin the env fallback so payment resolution cannot fail for a reason this suite is not testing.
// plugin_instances is GLOBAL control-plane state on a database every integration spec shares, so a
// concurrent spec enabling or disabling the Paystack instance would otherwise make resolvePaymentContext
// throw payments_not_configured — which maybeAutoTopUp catches and logs, leaving zero charges and a
// failure that only appears in a full run and never in isolation.
process.env.PAYSTACK_SECRET_KEY ??= "sk_test_auto_topup_concurrency";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;
const SECRET = "sk_test_auto_topup_concurrency_123456789";

describeDb("auto top-up concurrency", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 4 });
  const appDb = createAppDb(appUrl ?? "");
  const owner = postgres(superUrl ?? "", { max: 1 });
  const config = {
    get: (key: string) => (key === "PAYSTACK_SECRET_KEY" ? SECRET : undefined),
  } as unknown as ConfigService;
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  const service = new AutoTopupService(provisioning, appDb, config, killSwitch);
  const tenantId = randomUUID() as TenantId;

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Auto Topup Concurrency",
      slug: `auto-topup-${tenantId}`,
    });
    await provisioning.db.insert(ledgerAccounts).values({
      tenantId,
      kind: "customer",
      currency: "GHS",
      balanceMinor: 0n as MinorUnits,
    });
    await provisioning.db.insert(paymentAuthorizations).values({
      tenantId,
      authorizationCode: "AUTH_concurrency",
      email: "billing@example.com",
      reusable: true,
    });
  });

  beforeEach(async () => {
    await provisioning.db
      .delete(payments)
      .where(eq(payments.tenantId, tenantId));
    await service.updateAutoTopup(tenantId, {
      enabled: true,
      threshold_minor: "1000",
      top_up_minor: "5000",
      currency: "GHS",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await owner`DELETE FROM payments WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM auto_topup WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM payment_authorizations WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  it("elects one provider charge across concurrent threshold checks", async () => {
    const fetchSpy = successfulCharge(90211);

    await Promise.all(
      Array.from({ length: 12 }, () => service.maybeAutoTopUp(tenantId)),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const pending = await provisioning.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.kind, "auto_topup"),
          eq(payments.status, "pending"),
        ),
      );
    expect(pending).toHaveLength(1);
  });

  it("claims one durable threshold check across concurrent scheduler ticks", async () => {
    const fetchSpy = successfulCharge(90212);

    await Promise.all([service.scheduledCheck(), service.scheduledCheck()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [configRow] = await provisioning.db
      .select({ nextCheckAt: autoTopup.nextCheckAt })
      .from(autoTopup)
      .where(eq(autoTopup.tenantId, tenantId));
    expect(configRow?.nextCheckAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("recovers an orphaned intent with the same provider reference", async () => {
    const reference = `autotopup-${randomUUID()}`;
    await provisioning.db.insert(payments).values({
      tenantId,
      reference,
      kind: "auto_topup",
      provider: "paystack",
      providerMode: "live",
      amountMinor: 5000n as MinorUnits,
      currency: "GHS",
      email: "billing@example.com",
      status: "pending",
      updatedAt: new Date(Date.now() - 60_000),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: true,
            data: { status: "success", id: 90213 },
          }),
          { status: 200 },
        ),
      );

    await service.maybeAutoTopUp(tenantId);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.body).toContain(reference);
    const [recovered] = await provisioning.db
      .select({ providerRef: payments.providerRef })
      .from(payments)
      .where(eq(payments.reference, reference));
    expect(recovered?.providerRef).toBe("90213");
  });
});

function successfulCharge(providerId: number) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          status: true,
          data: { status: "success", id: providerId },
        }),
        { status: 200 },
      ),
  );
}

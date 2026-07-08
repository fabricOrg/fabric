import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
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

describeDb("flows (Lighthouse saga)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "");
  // Raw superuser for teardown: the ledger is append-only for app_runtime (same as the wallet spec).
  const owner = postgres(superUrl ?? "", { max: 1 });
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  const service = new FlowsService(appDb, killSwitch);
  const tenantId = randomUUID() as TenantId;

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Flows Test",
      slug: `flows-${tenantId}`,
    });
  });

  afterAll(async () => {
    await owner`DELETE FROM flow_records WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  it("start → confirm posts a real credit once, persists a complete record, replays idempotently", async () => {
    const started = await service.start(tenantId, {
      action: "start",
      msisdn: "+233544000001",
      currency: "GHS",
      minor: "5000",
      channel: "sms",
    });
    expect(started.correlationId).toMatch(/^corr_/);

    const rec = await service.confirm(tenantId, {
      action: "confirm",
      correlationId: started.correlationId,
      code: "123456",
    });
    expect(rec.charge.status).toBe("done");
    expect(rec.verify.status).toBe("done");
    expect(rec.amount.minor).toBe("5000");
    expect(await customerBalance(appDb, tenantId)).toBe(5000n);

    // Replay must NOT double-credit.
    const again = await service.confirm(tenantId, {
      action: "confirm",
      correlationId: started.correlationId,
      code: "123456",
    });
    expect(again.correlationId).toBe(started.correlationId);
    expect(await customerBalance(appDb, tenantId)).toBe(5000n);

    const feed = await service.list(tenantId);
    expect(
      feed.transactions.some((t) => t.correlationId === started.correlationId),
    ).toBe(true);
    const totalVolume = feed.series.reduce(
      (sum, p) => sum + BigInt(p.volumeMinor),
      0n,
    );
    expect(totalVolume).toBe(5000n);
  });

  it("rejects a wrong OTP without charging", async () => {
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

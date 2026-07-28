import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { commit, credit, reserve } from "@app/wallet";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OverviewService } from "./overview.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb("overview authoritative aggregates", () => {
  const owner = postgres(superUrl ?? "", { max: 1 });
  const appDb = createAppDb(appUrl ?? "", { max: 2 });
  const service = new OverviewService(appDb);
  const tenantId = randomUUID();
  let sandboxId = "";
  let liveId = "";
  let billedMessageId = "";

  beforeAll(async () => {
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'Overview Scale', ${`overview-${tenantId}`})`;
    const [application] = (await owner`
      INSERT INTO applications (tenant_id, name, slug)
      VALUES (${tenantId}, 'Default', 'default')
      RETURNING id`) as unknown as Array<{ id: string }>;
    const appId = application?.id ?? "";
    const environments = (await owner`
      INSERT INTO environments (tenant_id, application_id, type, status)
      VALUES
        (${tenantId}, ${appId}, 'sandbox', 'active'),
        (${tenantId}, ${appId}, 'live', 'active')
      RETURNING id, type`) as unknown as Array<{ id: string; type: string }>;
    sandboxId = environments.find((row) => row.type === "sandbox")?.id ?? "";
    liveId = environments.find((row) => row.type === "live")?.id ?? "";

    const sandboxMessages = (await owner`
      INSERT INTO messages (
        tenant_id, environment_id, sender_id, status, encoding, segments,
        cost_minor, currency
      )
      SELECT
        ${tenantId}, ${sandboxId}, 'Fabric',
        CASE WHEN n <= 50 THEN 'delivered'::message_status ELSE 'failed'::message_status END,
        'gsm7', 1, 1200, 'GHS'
      FROM generate_series(1, 75) n
      RETURNING id`) as unknown as Array<{ id: string }>;
    billedMessageId = sandboxMessages[0]?.id ?? "";

    await owner`
      INSERT INTO messages (
        tenant_id, environment_id, sender_id, status, encoding, segments,
        cost_minor, currency
      )
      SELECT ${tenantId}, ${liveId}, 'Fabric', 'delivered', 'gsm7', 1, 900, 'GHS'
      FROM generate_series(1, 15)`;

    await appDb.withTenant(tenantId, async (tx) => {
      await credit(tx, {
        currency: "GHS",
        amountMinor: 100_000n,
        idempotencyKey: `topup:${randomUUID()}`,
      });
      await reserve(tx, {
        currency: "GHS",
        amountMinor: 1_200n,
        idempotencyKey: `reserve:${billedMessageId}`,
        referenceId: billedMessageId,
      });
      await commit(tx, {
        idempotencyKey: `commit:${billedMessageId}`,
        referenceId: billedMessageId,
      });
    });

    // Each top-up writes two legs. These later rows push the billed reservation outside the
    // wallet snapshot's 100-entry page, proving this aggregate never depends on that page.
    for (let index = 0; index < 60; index += 1) {
      await appDb.withTenant(tenantId, (tx) =>
        credit(tx, {
          currency: "GHS",
          amountMinor: 1n,
          idempotencyKey: `topup:${randomUUID()}`,
        }),
      );
    }
  });

  afterAll(async () => {
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM environments WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([appDb.end(), owner.end()]);
  });

  it("counts beyond message pages and finds spend beyond ledger pages", async () => {
    const overview = await service.get(tenantId, sandboxId);

    expect(overview.messagesSent).toBe(75);
    expect(overview.deliveryRate).toBeCloseTo(50 / 75);
    expect(overview.spendThisMonth).toEqual({
      currency: "GHS",
      minor: "1200",
    });
    expect(
      overview.traffic.reduce((total, point) => total + point.sent, 0),
    ).toBe(75);
    expect(overview.traffic).toHaveLength(14);
    expect(overview.recentActivity).toHaveLength(6);
  });

  it("keeps the environment boundary in every message aggregate", async () => {
    const live = await service.get(tenantId, liveId);
    expect(live.messagesSent).toBe(15);
    expect(live.deliveryRate).toBe(1);
    expect(live.traffic.reduce((total, point) => total + point.sent, 0)).toBe(
      15,
    );
  });
});

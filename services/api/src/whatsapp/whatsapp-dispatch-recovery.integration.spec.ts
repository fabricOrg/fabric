import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { type AppDb, createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import {
  claimStoredWhatsapp,
  pendingWhatsappDispatches,
} from "./whatsapp-load.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

/**
 * Crash recovery for a claimed WhatsApp dispatch (migration 0147).
 *
 * WhatsApp claims a dispatch before calling Meta, which is what stops two workers on one Redis queue
 * from double-sending. The cost of a claim is that a worker which DIES holding it strands the row: it
 * sits at 'sending' with a wallet reserve that is never committed and never refunded. The sweeper used
 * to ask only for `status = 'pending'`, so it never saw those rows again.
 *
 * These tests pin both halves of the trade-off — a stale lease is reclaimable, a FRESH one is not.
 * The second is the one that matters: it is the double-send protection, and a lease timeout is exactly
 * the kind of change that quietly removes it.
 */
describeDb("whatsapp dispatch lease recovery", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 2 });
  let db: AppDb;
  const tenantId = randomUUID();
  const appId = randomUUID();
  const envId = randomUUID();
  // The claim reads content out of the vault only AFTER it has taken the lease, so these tests never
  // reach it — the dispatch state transition is the whole subject.
  const vault = {
    read: async () => null,
  } as unknown as PiiVaultService;

  async function seedDispatch(input: {
    status: "pending" | "sending";
    leasedMinutesAgo?: number;
  }): Promise<string> {
    const messageId = randomUUID();
    await owner`
      INSERT INTO whatsapp_messages (
        id, tenant_id, application_id, environment_id, subject_id, content_pii_id,
        template_name, template_language, template_category, status, status_rank,
        backing, provider_slug, cost_minor, currency
      ) VALUES (
        ${messageId}, ${tenantId}, ${appId}, ${envId},
        (SELECT subject_id FROM data_subjects WHERE tenant_id = ${tenantId} LIMIT 1), NULL,
        'order_update', 'en', 'utility', 'queued', 0,
        'wallet', 'meta-cloud', 30, 'GHS'
      )`;
    const leasedAt =
      input.leasedMinutesAgo === undefined
        ? null
        : new Date(Date.now() - input.leasedMinutesAgo * 60_000).toISOString();
    await owner`
      INSERT INTO whatsapp_dispatches (
        message_id, tenant_id, status, attempts, leased_at
      ) VALUES (
        ${messageId}, ${tenantId}, ${input.status}, ${input.status === "sending" ? 1 : 0},
        ${leasedAt}::text::timestamptz
      )`;
    return messageId;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = APP_URL;
    db = createAppDb(APP_URL ?? "", { max: 2 });
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'WA Recovery', ${`wa-recovery-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${envId}, ${tenantId}, ${appId}, 'live', 'active')`;
    await owner`
      INSERT INTO data_subjects (tenant_id, phone_hash)
      VALUES (${tenantId}, ${`recovery-${tenantId}`})`;
  });

  afterAll(async () => {
    for (const table of [
      "whatsapp_dispatches",
      "whatsapp_messages",
      "data_subjects",
    ]) {
      await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [
        tenantId,
      ]);
    }
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([owner.end(), db.end()]);
  });

  it("sweeps a dispatch abandoned mid-flight back into the queue", async () => {
    const stranded = await seedDispatch({
      status: "sending",
      leasedMinutesAgo: 30,
    });
    const pending = await pendingWhatsappDispatches(db, tenantId);
    expect(pending).toContain(stranded);
  });

  it("leaves a freshly claimed dispatch alone — that is the double-send guard", async () => {
    const inFlight = await seedDispatch({
      status: "sending",
      leasedMinutesAgo: 1,
    });
    const pending = await pendingWhatsappDispatches(db, tenantId);
    expect(pending).not.toContain(inFlight);
  });

  it("reclaims a stale lease and bumps the attempt count", async () => {
    const stranded = await seedDispatch({
      status: "sending",
      leasedMinutesAgo: 30,
    });
    // 'unreadable' is the expected verdict: the stub vault returns nothing. What matters is that the
    // CLAIM happened at all — before 0147 this returned the skipped-status path instead.
    const result = await claimStoredWhatsapp(db, vault, tenantId, stranded);
    expect(result.kind).toBe("unreadable");
    const [row] = await owner`
      SELECT status, attempts FROM whatsapp_dispatches WHERE message_id = ${stranded}`;
    expect(row).toMatchObject({ status: "sending", attempts: 2 });
  });

  it("refuses to reclaim a lease that has not expired", async () => {
    const inFlight = await seedDispatch({
      status: "sending",
      leasedMinutesAgo: 1,
    });
    const result = await claimStoredWhatsapp(db, vault, tenantId, inFlight);
    // Not claimed: it reports the message's own status rather than taking the work.
    expect(result.kind).toBe("skip");
    const [row] = await owner`
      SELECT attempts FROM whatsapp_dispatches WHERE message_id = ${inFlight}`;
    expect(Number(row?.attempts)).toBe(1);
  });

  it("marks a resolved dispatch 'completed' rather than leaving it 'sending'", async () => {
    // The state the live send exposed: delivered message, dispatch still claiming to be mid-flight.
    // 'completed' was not even a legal value before 0147, so the CHECK proves the migration applied.
    const messageId = await seedDispatch({ status: "pending" });
    await owner`
      UPDATE whatsapp_dispatches
      SET status = 'completed', completed_at = now()
      WHERE message_id = ${messageId}`;
    const [row] = await owner`
      SELECT status, completed_at FROM whatsapp_dispatches WHERE message_id = ${messageId}`;
    expect(row?.status).toBe("completed");
    // And a completed dispatch is never swept, whatever its lease says.
    expect(await pendingWhatsappDispatches(db, tenantId)).not.toContain(
      messageId,
    );
  });
});

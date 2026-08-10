import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { type AppDb, createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import {
  claimStoredDispatch,
  completeStoredDispatch,
  pendingDispatches,
} from "./sms-dispatch-store.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

/**
 * The SMS dispatch CLAIM (migration 0148) — the same defect fixed for WhatsApp in d341789.
 *
 * Before this, `loadStoredDispatch` was a plain SELECT: the provider was called, and only afterwards
 * was completion recorded. The first database lock landed AFTER the carrier call, so two workers on one
 * Redis queue both read a non-terminal row and both sent. Two real SMS, two charges, one message id.
 *
 * The concurrency case below is the one that matters and the one a single-threaded test cannot express:
 * two claims issued at once, exactly one winner. The rest pin the lease's edges, because a claim with
 * no expiry trades a double-send for a permanent orphan whose wallet reserve is never settled.
 */
describeDb("sms dispatch claim", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 4 });
  let db: AppDb;
  const tenantId = randomUUID();
  const appId = randomUUID();
  const envId = randomUUID();
  // The claim reads vault material only AFTER it has taken the lease, so these tests never reach it —
  // an unreadable body still means CLAIMED, which is what is under test.
  const vault = {
    readLatest: async () => null,
    read: async () => null,
  } as unknown as PiiVaultService;

  async function seed(input: {
    status?: "pending" | "sending" | "completed";
    leasedMinutesAgo?: number;
    completed?: boolean;
  }): Promise<string> {
    const messageId = randomUUID();
    await owner`
      INSERT INTO messages (
        id, tenant_id, application_id, environment_id, sender_id, status,
        encoding, segments, cost_minor, currency
      ) VALUES (
        ${messageId}, ${tenantId}, ${appId}, ${envId}, 'FABRIC', 'queued',
        'gsm7', 1, 30, 'GHS'
      )`;
    const leasedAt =
      input.leasedMinutesAgo === undefined
        ? null
        : new Date(Date.now() - input.leasedMinutesAgo * 60_000).toISOString();
    await owner`
      INSERT INTO message_dispatches (
        message_id, tenant_id, status, attempts, leased_at, completed_at
      ) VALUES (
        ${messageId}, ${tenantId}, ${input.status ?? "pending"},
        ${input.status === "sending" ? 1 : 0},
        ${leasedAt}::text::timestamptz,
        ${input.completed ? new Date().toISOString() : null}::text::timestamptz
      )`;
    return messageId;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = APP_URL;
    db = createAppDb(APP_URL ?? "", { max: 4 });
    await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'SMS Claim', ${`sms-claim-${tenantId}`})`;
    await owner`
      INSERT INTO applications (id, tenant_id, name, slug)
      VALUES (${appId}, ${tenantId}, 'Primary', 'primary')`;
    await owner`
      INSERT INTO environments (id, tenant_id, application_id, type, status)
      VALUES (${envId}, ${tenantId}, ${appId}, 'live', 'active')`;
  });

  afterAll(async () => {
    for (const table of ["message_dispatches", "messages"]) {
      await owner.unsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, [
        tenantId,
      ]);
    }
    await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([owner.end(), db.end()]);
  });

  it("lets exactly ONE of two concurrent claims through", async () => {
    const messageId = await seed({});
    // Both issued before either resolves — this is the two-workers-one-queue race, and the whole reason
    // the claim exists. Under the old plain SELECT both of these would have returned a sendable row.
    const [first, second] = await Promise.all([
      claimStoredDispatch({ db, vault, tenantId, messageId }),
      claimStoredDispatch({ db, vault, tenantId, messageId }),
    ]);
    const claimed = [first, second].filter((r) => r.kind !== "skip");
    expect(claimed).toHaveLength(1);
    const skipped = [first, second].filter((r) => r.kind === "skip");
    expect(skipped).toHaveLength(1);

    // The loser reports the message's own status rather than inventing a failure — it is not our send,
    // but nothing is wrong with the message.
    expect(skipped[0]).toMatchObject({ kind: "skip", status: "queued" });

    // One claim means one attempt. A second increment here would mean both workers had proceeded.
    const [row] = await owner`
      SELECT status, attempts FROM message_dispatches WHERE message_id = ${messageId}`;
    expect(row).toMatchObject({ status: "sending", attempts: 1 });
  });

  it("refuses to reclaim a lease that has not expired", async () => {
    const messageId = await seed({ status: "sending", leasedMinutesAgo: 1 });
    const result = await claimStoredDispatch({
      db,
      vault,
      tenantId,
      messageId,
    });
    expect(result.kind).toBe("skip");
    const [row] = await owner`
      SELECT attempts FROM message_dispatches WHERE message_id = ${messageId}`;
    expect(Number(row?.attempts)).toBe(1);
  });

  it("reclaims a dispatch whose worker died holding the lease", async () => {
    // Without this the claim would have traded a double-send for a stranded reserve: the row sits at
    // 'sending' forever, neither committed nor refunded, invisible to the sweeper.
    const messageId = await seed({ status: "sending", leasedMinutesAgo: 30 });
    const result = await claimStoredDispatch({
      db,
      vault,
      tenantId,
      messageId,
    });
    expect(result.kind).not.toBe("skip");
    const [row] = await owner`
      SELECT attempts FROM message_dispatches WHERE message_id = ${messageId}`;
    expect(Number(row?.attempts)).toBe(2);
  });

  it("never claims a dispatch that already completed", async () => {
    const messageId = await seed({ status: "completed", completed: true });
    const result = await claimStoredDispatch({
      db,
      vault,
      tenantId,
      messageId,
    });
    expect(result.kind).toBe("skip");
  });

  it("keeps the sweeper off work a live worker holds, and recovers the abandoned", async () => {
    const inFlight = await seed({ status: "sending", leasedMinutesAgo: 1 });
    const stranded = await seed({ status: "sending", leasedMinutesAgo: 30 });
    const fresh = await seed({});
    const pending = (await pendingDispatches(db, tenantId)).map(
      (d) => d.messageId,
    );
    expect(pending).toContain(fresh);
    expect(pending).toContain(stranded);
    // Re-enqueuing an in-flight dispatch is precisely how a retry races the original send.
    expect(pending).not.toContain(inFlight);
  });

  it("marks a completed dispatch so the sweeper drops it", async () => {
    const messageId = await seed({});
    await completeStoredDispatch(db, tenantId, messageId);
    const [row] = await owner`
      SELECT status, completed_at FROM message_dispatches WHERE message_id = ${messageId}`;
    expect(row?.status).toBe("completed");
    expect(row?.completed_at).toBeTruthy();
    const pending = (await pendingDispatches(db, tenantId)).map(
      (d) => d.messageId,
    );
    expect(pending).not.toContain(messageId);
  });
});

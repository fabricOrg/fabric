import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import { credit, reserve } from "@app/wallet";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsentService } from "../consent/consent.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { AutoTopupService } from "../payments/auto-topup.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { MaintenanceService } from "./maintenance.service.js";

// E10-S4: sender enforcement has its own spec — these flows always pass the gate.
// E10-S5: consent enforcement has its own spec — nobody is opted out here.
const consentAllowAll = {
  isSuppressed: async () => false,
} as unknown as ConsentService;
const sendersAlwaysActive = {
  isActiveSender: async () => true,
} as unknown as SendersService;
const liveMode = {
  resolveMode: async () => "live",
} as unknown as VirtualPhoneService;

/**
 * MAINTENANCE JOB — integration spec (finding 1+2 of the architecture remediation).
 * Proves the two money-correctness jobs against a real migrated Postgres:
 *   1. Sweeper: a message stuck `sending` past the TTL (crash between reserve and the provider
 *      outcome) is resolved `expired` and its reservation refunded EXACTLY once — under repeated
 *      and concurrent runs (advisory lock + idempotent wallet primitives).
 *   2. Invariant: a healthy ledger passes; a seeded projection drift is detected and reported.
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

type Row = Record<string, unknown>;

describeDb("scheduled maintenance (sweeper + ledger invariant)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 4 });
  const appDb = createAppDb(appUrl ?? "");
  // Raw superuser connection: seed clock rewinds + teardown (the ledger is append-only for
  // app_runtime) — same pattern as the payments/wallet specs.
  const owner = postgres(superUrl ?? "", { max: 1 });

  const config = {
    // Default provider (fake), default TTL (15m), cron gate irrelevant — tests call
    // runSweep()/runInvariant() directly.
    get: () => undefined,
  } as unknown as ConfigService;
  // Real vault against the test Postgres: the send path tokenizes every recipient.
  const vault = new PiiVaultService(appDb, config);
  const killSwitch = {
    isPaused: async () => false,
  } as unknown as KillSwitchService;
  // sweepStuck never touches auto-top-up; a bare stub keeps the test honest about what runs.
  const autoTopup = {} as AutoTopupService;

  // Queue disabled (no REDIS_QUEUE_URL) → inline send path; the sweeper never enqueues anyway.
  const sms = new SmsService(
    appDb,
    autoTopup,
    killSwitch,
    config,
    new QueueService(config),
    sendersAlwaysActive,
    consentAllowAll,
    liveMode,
    vault,
  );
  const maintenance = new MaintenanceService(provisioning, sms, config);

  const tenantId = randomUUID() as TenantId;
  const CREDIT = 10_000n;
  const COST = 250n;

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Maintenance Test",
      slug: `maint-${tenantId}`,
    });
    // Fund the wallet so the reservations below succeed.
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: CREDIT,
        idempotencyKey: `topup:maint-${tenantId}`,
      }),
    );
  });

  afterAll(async () => {
    await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  /** Persist a message as `sending` + reserve — exactly the engine's tx1 (the pre-crash state). */
  async function seedStuckMessage(): Promise<string> {
    const id = await appDb.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        INSERT INTO messages (tenant_id, sender_id, status, status_rank, encoding, segments, cost_minor, currency, provider_slug)
        VALUES (current_setting('app.tenant_id')::uuid, 'FABRIC', 'sending', ${STATUS_RANK.sending}, 'gsm7', 1, ${COST.toString()}::bigint, 'GHS', 'fake-sms')
        RETURNING id`) as Row[];
      const messageId = String(rows[0]?.id);
      await reserve(tx, {
        currency: "GHS",
        amountMinor: COST,
        idempotencyKey: `reserve:${messageId}`,
        referenceId: messageId,
      });
      return messageId;
    });
    // Rewind the clock: stuck for an hour, well past the 15-minute default TTL.
    await owner`
      UPDATE messages SET updated_at = now() - interval '1 hour' WHERE id = ${id}`;
    return id;
  }

  async function customerBalance(): Promise<bigint> {
    const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  }

  it("sweeps a stuck reservation: expired + refunded exactly once, even run twice", async () => {
    const messageId = await seedStuckMessage();
    expect(await customerBalance()).toBe(CREDIT - COST);

    const first = await maintenance.runSweep();
    expect(first.locked).toBe(true);
    expect(first.sweptTenants[tenantId]).toBe(1);

    const [msg] = await owner`
      SELECT status FROM messages WHERE id = ${messageId}`;
    expect(msg?.status).toBe("expired");
    // Reservation released — full credit is back.
    expect(await customerBalance()).toBe(CREDIT);

    // Second pass: message is terminal now — nothing to sweep, no double refund.
    const second = await maintenance.runSweep();
    expect(second.sweptTenants[tenantId] ?? 0).toBe(0);
    expect(await customerBalance()).toBe(CREDIT);

    // Exactly ONE refund movement exists for this message (one balanced movement = 2 legs).
    const refunds = await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'sms_refund' AND reference_id = ${messageId}`;
    expect(Number(refunds[0]?.n)).toBe(2);
  });

  it("concurrent runs: money moves exactly once", async () => {
    const messageId = await seedStuckMessage();
    const before = await customerBalance();

    await Promise.all([maintenance.runSweep(), maintenance.runSweep()]);
    // Whatever interleaving happened (lock skip or serialized second pass), one refund landed.
    expect(await customerBalance()).toBe(before + COST);
    const refunds = await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'sms_refund' AND reference_id = ${messageId}`;
    expect(Number(refunds[0]?.n)).toBe(2);
  });

  it("reports the ledger invariant green on a healthy ledger", async () => {
    const result = await maintenance.runInvariant();
    expect(result?.ok).toBe(true);
  });

  it("detects seeded projection drift and reports the drifted account", async () => {
    const [acct] = await owner`
      SELECT id FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    const accountId = String(acct?.id);
    // Simulate corruption: nudge the cached projection off the append-only truth (no trigger
    // guards ledger_accounts UPDATEs — the write-time trigger lives on ledger_entries — which is
    // exactly why the standing invariant job must exist).
    await owner`
      UPDATE ledger_accounts SET balance_minor = balance_minor + 1 WHERE id = ${accountId}`;
    try {
      const result = await maintenance.runInvariant();
      expect(result?.ok).toBe(false);
      expect(
        result?.driftedAccounts.some((d) => d.accountId === accountId),
      ).toBe(true);
    } finally {
      await owner`
        UPDATE ledger_accounts SET balance_minor = balance_minor - 1 WHERE id = ${accountId}`;
    }
  });
});

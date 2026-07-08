import { randomUUID } from "node:crypto";
import type {
  ConfirmFlowRequest,
  FlowLedgerEntry,
  StartFlowRequest,
  StartFlowResponse,
  TransactionRecord,
  TransactionsResponse,
} from "@app/contracts";
import type { AppDb, TenantId, TenantTx } from "@app/db";
import { credit } from "@app/wallet";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";

// Slice-1 verification: a fixed dev code. Real OTP generation + delivery (SMS/Verify provider) is a
// later, human-gated slice — the record + the ledger charge below are already real.
const DEV_OTP = "123456";
const TRAFFIC_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Raw flow_records row (snake_case; bigint columns arrive as strings, timestamps as Date). */
interface FlowRow {
  correlation_id: string;
  status: string;
  customer: string;
  channel: string;
  currency: string;
  amount_minor: string;
  verify_status: string;
  verification_id: string | null;
  verify_at: Date | string | null;
  charge_status: string;
  charge_at: Date | string | null;
  charge_entries: FlowLedgerEntry[] | null;
  notify_status: string;
  notify_message_id: string | null;
  notify_at: Date | string | null;
  audit_actor: string;
  created_at: Date | string;
}

/** Postgres timestamps arrive as Date or ISO string depending on driver config — normalise to ISO. */
function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function mask(msisdn: string): string {
  return `${msisdn.slice(0, 6)}●●●${msisdn.slice(-2)}`;
}

/**
 * Lighthouse flow (Transactions explorer): verify → charge → notify, one reconciled record keyed by
 * correlationId. Slice 1 — records persist (tenant-scoped, RLS); the charge posts a REAL ledger
 * credit via @app/wallet (idempotent on the correlationId); verify uses a dev OTP and notify is
 * recorded. Real customer-collection + OTP delivery + live SMS are later gated slices.
 */
@Injectable()
export class FlowsService {
  constructor(
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
  ) {}

  async list(tenantId: string): Promise<TransactionsResponse> {
    return this.appDb.withTenant(tenantId as TenantId, async (tx) => {
      const rows = (await tx`
        SELECT * FROM flow_records
        WHERE status = 'complete'
        ORDER BY created_at DESC
        LIMIT 100`) as unknown as FlowRow[];
      return {
        transactions: rows.slice(0, 50).map(toRecord),
        series: buildSeries(rows),
      };
    });
  }

  async start(
    tenantId: string,
    request: StartFlowRequest,
  ): Promise<StartFlowResponse> {
    const scoped = tenantId as TenantId;
    const correlationId = `corr_${randomUUID().slice(0, 12)}`;
    const verificationId = `ver_${randomUUID().slice(0, 10)}`;
    await this.appDb.withTenant(
      scoped,
      (tx) => tx`
      INSERT INTO flow_records
        (tenant_id, correlation_id, status, customer, channel, currency, amount_minor,
         verification_id, verify_status, audit_actor)
      VALUES
        (${scoped}, ${correlationId}, 'pending', ${mask(request.msisdn)}, ${request.channel},
         ${request.currency}, ${request.minor}, ${verificationId}, 'pending', 'dashboard')`,
    );
    return { correlationId, verificationId, otpSentTo: mask(request.msisdn) };
  }

  async confirm(
    tenantId: string,
    request: ConfirmFlowRequest,
  ): Promise<TransactionRecord> {
    if (await this.killSwitch.isPaused("platform.payments")) {
      throw invalidRequest("payments_paused", "Collections are paused.");
    }
    const scoped = tenantId as TenantId;
    return this.appDb.withTenant(scoped, async (tx: TenantTx) => {
      const [row] = (await tx`
        SELECT * FROM flow_records
        WHERE correlation_id = ${request.correlationId}
        FOR UPDATE`) as unknown as FlowRow[];
      if (!row) throw notFound("flow_not_found", "No such transaction.");
      if (row.status === "complete") return toRecord(row); // idempotent replay
      if (request.code.trim() !== DEV_OTP) {
        throw invalidRequest(
          "otp_invalid",
          "That verification code is incorrect.",
        );
      }

      // Charge: real double-entry credit into the tenant wallet, idempotent on the correlationId.
      await credit(tx, {
        currency: row.currency,
        amountMinor: BigInt(row.amount_minor),
        idempotencyKey: `flow:${request.correlationId}`,
      });

      const entries = chargeEntries(row.currency, row.amount_minor);
      const [updated] = (await tx`
        UPDATE flow_records SET
          status = 'complete',
          verify_status = 'done', verify_at = now(),
          charge_status = 'done', charge_at = now(),
          charge_entries = ${JSON.stringify(entries)}::jsonb,
          notify_status = 'done', notify_message_id = ${`msg_${randomUUID().slice(0, 10)}`}, notify_at = now(),
          updated_at = now()
        WHERE correlation_id = ${request.correlationId}
        RETURNING *`) as unknown as FlowRow[];
      return toRecord(updated ?? row);
    });
  }
}

function chargeEntries(currency: string, minor: string): FlowLedgerEntry[] {
  const amount = { currency: currency as never, minor };
  return [
    {
      account: "payments:collection-clearing",
      label: "Customer collection",
      direction: "debit",
      amount,
    },
    {
      account: "wallet:available",
      label: "Tenant wallet",
      direction: "credit",
      amount,
    },
  ];
}

function toRecord(row: FlowRow): TransactionRecord {
  const amount = { currency: row.currency as never, minor: row.amount_minor };
  const createdAt = new Date(row.created_at).toISOString();
  return {
    correlationId: row.correlation_id,
    createdAt,
    customer: row.customer,
    channel: row.channel,
    amount,
    verify: {
      status: row.verify_status as never,
      verificationId: row.verification_id,
      at: iso(row.verify_at),
    },
    charge: {
      status: row.charge_status as never,
      at: iso(row.charge_at),
      entries: row.charge_entries ?? [],
    },
    notify: {
      status: row.notify_status as never,
      messageId: row.notify_message_id,
      at: iso(row.notify_at),
    },
    audit: { actor: row.audit_actor, at: createdAt },
  };
}

/** Last-14-day daily rollup: collected volume (exact minor units) + transaction count. */
function buildSeries(rows: FlowRow[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (TRAFFIC_DAYS - 1) * DAY_MS);
  const buckets = new Map<string, { volume: bigint; count: number }>();
  const series: { date: string; volumeMinor: string; count: number }[] = [];
  for (let i = 0; i < TRAFFIC_DAYS; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    buckets.set(d.toISOString().slice(0, 10), { volume: 0n, count: 0 });
    series.push({
      date: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      volumeMinor: "0",
      count: 0,
    });
  }
  for (const row of rows) {
    const bucket = buckets.get(
      new Date(row.created_at).toISOString().slice(0, 10),
    );
    if (!bucket) continue;
    bucket.volume += BigInt(row.amount_minor);
    bucket.count += 1;
  }
  for (let i = 0; i < TRAFFIC_DAYS; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const bucket = buckets.get(d.toISOString().slice(0, 10));
    const point = series[i];
    if (bucket && point) {
      point.volumeMinor = bucket.volume.toString();
      point.count = bucket.count;
    }
  }
  return series;
}

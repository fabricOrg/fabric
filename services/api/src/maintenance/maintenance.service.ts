import {
  checkLedgerInvariants,
  formatViolations,
  type LedgerInvariantResult,
  type ProvisioningDb,
} from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { SmsService } from "../sms/sms.service.js";
import { VirtualPhoneService } from "../sms/virtual-phone.service.js";

/**
 * SCHEDULED MAINTENANCE (ARCHITECTURE §10 made real) — two money-correctness jobs that previously
 * existed only as library code + tests, with NO production trigger:
 *
 *  1. Reservation sweeper (every 5 min): a crash between reserve (tx1) and the provider outcome
 *     (tx2) leaves a message stuck non-terminal with customer funds parked in reserved_clearing.
 *     The sweep resolves anything past the TTL as `expired` (refund if it never reached a billable
 *     status). Time-sensitive — parked customer money — so it runs on the tight cadence. Its
 *     discovery scan stays cheap forever via the partial non-terminal index (migration 0028).
 *  2. Ledger invariant check (hourly): per-txn trial balance + per-account projection integrity,
 *     global. Two full-ledger aggregates — O(all ledger rows) — so it deliberately runs on the
 *     SLOW cadence: at 5 minutes the RDS cost would grow linearly with ledger history for a check
 *     that almost never changes answer. Drift is a page-worthy event — logged as an error with the
 *     full violation report.
 *
 * RLS shape: cross-tenant DISCOVERY (which tenants have stuck messages / the global invariant
 * read) runs on the provisioner connection, whose reach on messages/ledger_* is SELECT-ONLY
 * (migration 0027). The sweep MUTATION runs per-tenant through SmsService → withTenant on
 * app_runtime, so RLS still guards every write.
 *
 * Concurrency: each job takes its own pg_try_advisory_xact_lock, so overlapping runs (multiple
 * ECS tasks, slow run vs next tick) are a no-op rather than duplicate work. The sweep itself is
 * idempotent anyway (commit/refund keys + the B6 exclusivity index) — the lock is an efficiency,
 * not a guard.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** Advisory lock keys (arbitrary but stable app-wide constants; one per job). */
  private static readonly SWEEP_LOCK_KEY = 727_001;
  private static readonly INVARIANT_LOCK_KEY = 727_002;
  private static readonly LOG_RETENTION_LOCK_KEY = 727_003;
  private static readonly DISPATCH_LOCK_KEY = 727_004;

  /** How long request_logs are kept before the daily retention sweep deletes them. */
  private logRetentionDays(): number {
    const raw = this.config.get<string>("REQUEST_LOG_RETENTION_DAYS");
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  /** Reservation TTL: how long a message may sit non-terminal before the sweeper expires it. */
  private ttlMinutes(): number {
    const raw = this.config.get<string>("MAINTENANCE_SWEEP_TTL_MINUTES");
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  }

  /** Cron gate so integration tests (which build the Nest app) don't run wall-clock jobs. */
  private cronEnabled(): boolean {
    return this.config.get<string>("MAINTENANCE_CRON_ENABLED") !== "false";
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepTick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.runSweep();
    } catch (error) {
      // Never let a maintenance failure crash the process; next tick retries.
      this.logger.error(
        `sweep run failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async invariantTick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.runInvariant();
    } catch (error) {
      this.logger.error(
        `invariant run failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchTick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.runDispatchRecovery();
    } catch (error) {
      this.logger.error(
        `dispatch recovery failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** Recover dispatch intents that committed but were not durably accepted by Redis. */
  async runDispatchRecovery(): Promise<{
    locked: boolean;
    enqueued: number;
  }> {
    return this.provisioning.db.transaction(async (tx) => {
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${MaintenanceService.DISPATCH_LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) return { locked: false, enqueued: 0 };

      const tenants = (await tx.execute(
        sql`SELECT DISTINCT tenant_id FROM message_dispatches
            WHERE completed_at IS NULL AND available_at <= now()`,
      )) as Array<{ tenant_id: string }>;
      let enqueued = 0;
      for (const row of tenants) {
        enqueued += await this.sms.enqueuePending(String(row.tenant_id));
      }
      if (enqueued > 0) {
        this.logger.log(`dispatch recovery: enqueued ${enqueued} message(s)`);
      }
      return { locked: true, enqueued };
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async logRetentionTick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.runLogRetention();
    } catch (error) {
      this.logger.error(
        `log retention run failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * One request-log retention pass (also the test entry point). Deletes rows past the retention
   * window across all tenants on the provisioner connection (request_logs grants app_provisioner
   * DELETE; cross-tenant by design — no per-tenant loop for a pure purge). Advisory-locked so
   * overlapping ticks are a no-op. Returns rows deleted.
   */
  async runLogRetention(): Promise<{ locked: boolean; deleted: number }> {
    return this.provisioning.db.transaction(async (tx) => {
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${MaintenanceService.LOG_RETENTION_LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) return { locked: false, deleted: 0 };

      const cutoffIso = new Date(
        Date.now() - this.logRetentionDays() * 86_400_000,
      ).toISOString();
      const deletedRows = (await tx.execute(
        sql`DELETE FROM request_logs WHERE created_at < ${cutoffIso}::timestamptz RETURNING id`,
      )) as Array<{ id: string }>;
      if (deletedRows.length > 0) {
        this.logger.log(
          `log retention: deleted ${deletedRows.length} request log(s) older than ${this.logRetentionDays()}d`,
        );
      }
      return { locked: true, deleted: deletedRows.length };
    });
  }

  /**
   * One sweep pass (also the test entry point). Returns what happened so tests and callers can
   * assert without scraping logs. `sweptTenants` maps tenantId → resolved count.
   */
  async runSweep(): Promise<{
    locked: boolean;
    sweptTenants: Record<string, number>;
  }> {
    return this.provisioning.db.transaction(async (tx) => {
      // Skip-if-running: the xact lock releases automatically when this transaction ends.
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${MaintenanceService.SWEEP_LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) {
        return { locked: false, sweptTenants: {} };
      }

      const cutoffIso = new Date(
        Date.now() - this.ttlMinutes() * 60_000,
      ).toISOString();

      // Discovery (provisioner, read-only): which tenants have stuck non-terminal messages.
      // Served by the partial idx_messages_nonterminal_updated (0028) — near-empty when healthy.
      const stuckRows = (await tx.execute(
        sql`SELECT DISTINCT tenant_id FROM messages
            WHERE status IN ('queued','sending','accepted','sent')
              AND updated_at < ${cutoffIso}::timestamptz`,
      )) as Array<{ tenant_id: string }>;

      // Mutation (app_runtime, per-tenant via withTenant): the actual sweep. A single tenant's
      // failure must not starve the rest — log and continue.
      const sweptTenants: Record<string, number> = {};
      for (const row of stuckRows) {
        const tenantId = String(row.tenant_id);
        try {
          const swept = await this.sms.sweepStuck(tenantId, cutoffIso);
          sweptTenants[tenantId] = swept;
          if (swept > 0) {
            this.logger.log(
              `sweeper: resolved ${swept} stuck message(s) for tenant ${tenantId}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `sweeper: tenant ${tenantId} failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }

      // Purge expired client idempotency keys (replay window, not an archive). Cross-tenant DELETE
      // on the provisioner via the scoped provisioner_purge policy (0030); served by the
      // expires_at index, so it stays cheap at any volume.
      await tx.execute(
        sql`DELETE FROM api_idempotency_keys WHERE expires_at < now()`,
      );

      const virtualCutoff = new Date(
        Date.now() - this.virtualPhoneRetentionDays() * 86_400_000,
      ).toISOString();
      const virtualTenants = (await tx.execute(
        sql`SELECT DISTINCT tenant_id FROM inbound_messages
            WHERE created_at < ${virtualCutoff}::timestamptz
            UNION
            SELECT DISTINCT tenant_id FROM messages
            WHERE delivery_mode = 'virtual' AND created_at < ${virtualCutoff}::timestamptz`,
      )) as Array<{ tenant_id: string }>;
      for (const row of virtualTenants) {
        try {
          await this.virtualPhone.purgeExpired(
            String(row.tenant_id),
            virtualCutoff,
          );
        } catch (error) {
          this.logger.error(
            `virtual phone retention failed for ${String(row.tenant_id)}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }

      return { locked: true, sweptTenants };
    });
  }

  private virtualPhoneRetentionDays(): number {
    const parsed = Number(
      this.config.get<string>("VIRTUAL_PHONE_RETENTION_DAYS") ?? "30",
    );
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  }

  /**
   * One global invariant pass (also the test entry point). Returns the result, or null when
   * another runner holds the lock. Drift = page-worthy error log.
   */
  async runInvariant(): Promise<LedgerInvariantResult | null> {
    return this.provisioning.db.transaction(async (tx) => {
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${MaintenanceService.INVARIANT_LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) return null;

      const invariant = await checkLedgerInvariants({
        query: async (q: string) => ({
          rows: (await tx.execute(sql.raw(q))) as Array<
            Record<string, unknown>
          >,
        }),
      });
      if (!invariant.ok) {
        this.logger.error(
          `LEDGER INVARIANT VIOLATION\n${formatViolations(invariant)}`,
        );
      }
      return invariant;
    });
  }
}

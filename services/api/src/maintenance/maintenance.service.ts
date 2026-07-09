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

/**
 * SCHEDULED MAINTENANCE (ARCHITECTURE §10 made real) — two money-correctness jobs that previously
 * existed only as library code + tests, with NO production trigger:
 *
 *  1. Reservation sweeper: a crash between reserve (tx1) and the provider outcome (tx2) leaves a
 *     message stuck non-terminal with customer funds parked in reserved_clearing. The sweep
 *     resolves anything past the TTL as `expired` (refund if it never reached a billable status).
 *  2. Ledger invariant check: per-txn trial balance + per-account projection integrity, global.
 *     Drift is a page-worthy event — logged as an error with the full violation report.
 *
 * RLS shape: cross-tenant DISCOVERY (which tenants have stuck messages / the global invariant
 * read) runs on the provisioner connection, whose reach on messages/ledger_* is SELECT-ONLY
 * (migration 0027). The sweep MUTATION runs per-tenant through SmsService → withTenant on
 * app_runtime, so RLS still guards every write.
 *
 * Concurrency: pg_try_advisory_xact_lock makes overlapping runs (multiple ECS tasks, slow sweep
 * vs next tick) a no-op rather than duplicate work. The sweep itself is idempotent anyway
 * (commit/refund keys + the B6 exclusivity index), so the lock is an efficiency, not a guard.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** Advisory lock key for the maintenance run (arbitrary but stable app-wide constant). */
  private static readonly LOCK_KEY = 727_001;

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
  async tick(): Promise<void> {
    if (!this.cronEnabled()) return;
    try {
      await this.runOnce();
    } catch (error) {
      // Never let a maintenance failure crash the process; next tick retries.
      this.logger.error(
        `maintenance run failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * One full maintenance pass (also the test entry point). Returns what happened so tests and
   * callers can assert without scraping logs. `sweptTenants` maps tenantId → resolved count.
   */
  async runOnce(): Promise<{
    locked: boolean;
    sweptTenants: Record<string, number>;
    invariant: LedgerInvariantResult | null;
  }> {
    return this.provisioning.db.transaction(async (tx) => {
      // Skip-if-running: the xact lock releases automatically when this transaction ends.
      const lockRows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${MaintenanceService.LOCK_KEY}) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (lockRows[0]?.locked !== true) {
        return { locked: false, sweptTenants: {}, invariant: null };
      }

      const cutoffIso = new Date(
        Date.now() - this.ttlMinutes() * 60_000,
      ).toISOString();

      // Discovery (provisioner, read-only): which tenants have stuck non-terminal messages.
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

      // Global invariant check (provisioner, read-only). Drift = page-worthy error log.
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

      return { locked: true, sweptTenants, invariant };
    });
  }
}

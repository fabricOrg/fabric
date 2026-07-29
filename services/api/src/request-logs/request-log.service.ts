import type { ListRequestLogsResponse } from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  clampLimit,
  decodeCursor,
  type EnvironmentId,
  encodeCursor,
  environments,
  keysetWhere,
  type ProvisioningDb,
  requestLogs,
  type TenantId,
  takePage,
} from "@app/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

export interface RequestLogEntry {
  readonly tenantId: string;
  readonly applicationId: string | null;
  readonly environmentId: string | null;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly requestId: string;
  readonly latencyMs: number;
  readonly keyId: string;
}

/**
 * Request-log capture + query (W-B). `record()` buffers bounded metadata and never throws to the
 * caller. Batches use the provisioner connection, reducing one-write-per-request amplification.
 * Store failure drops telemetry rather than customer traffic. `list()` remains an RLS-scoped,
 * keyset-paginated app_runtime read.
 */
@Injectable()
export class RequestLogService implements OnModuleDestroy {
  private readonly logger = new Logger(RequestLogService.name);
  private readonly buffer: RequestLogEntry[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private flushing: Promise<void> | null = null;
  private dropped = 0;

  constructor(
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {
    this.flushTimer = setInterval(() => void this.flush(), 250);
    this.flushTimer.unref();
  }

  /** Buffer a telemetry row; a full buffer sheds logs, never customer traffic. */
  record(entry: RequestLogEntry): void {
    if (this.buffer.length >= 10_000) {
      this.dropped += 1;
      if (this.dropped === 1 || this.dropped % 1_000 === 0) {
        this.logger.warn(
          `request-log buffer full; dropped ${this.dropped} row(s)`,
        );
      }
      return;
    }
    this.buffer.push(entry);
    if (this.buffer.length >= 100) void this.flush();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);
    while (this.buffer.length > 0 || this.flushing) {
      if (this.flushing) await this.flushing;
      else await this.flush();
    }
  }

  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const batch = this.buffer.splice(0, 100);
    if (batch.length === 0) return Promise.resolve();
    this.flushing = this.insertBatch(batch).finally(() => {
      this.flushing = null;
      if (this.buffer.length >= 100) void this.flush();
    });
    return this.flushing;
  }

  private async insertBatch(batch: RequestLogEntry[]): Promise<void> {
    try {
      await this.provisioning.db.insert(requestLogs).values(
        batch.map((entry) => ({
          tenantId: entry.tenantId as TenantId,
          applicationId: (entry.applicationId as ApplicationId | null) ?? null,
          environmentId: (entry.environmentId as EnvironmentId | null) ?? null,
          method: entry.method,
          path: entry.path,
          statusCode: entry.statusCode,
          requestId: entry.requestId,
          latencyMs: entry.latencyMs,
          keyId: entry.keyId,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `request-log batch dropped (${batch.length} row(s)): ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  /** Keyset-paginated newest-first, scoped to the tenant (RLS) + optionally an application + env. */
  async list(
    tenantId: string,
    opts: {
      applicationId?: string;
      envType?: "sandbox" | "live";
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<ListRequestLogsResponse> {
    const pageSize = clampLimit(opts.limit);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const keyset = keysetWhere(
      requestLogs.createdAt,
      requestLogs.id,
      "desc",
      decoded
        ? { primaryValue: new Date(decoded.primary), id: decoded.id }
        : null,
    );

    const rows = await this.appDb.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({
          id: requestLogs.id,
          method: requestLogs.method,
          path: requestLogs.path,
          status_code: requestLogs.statusCode,
          request_id: requestLogs.requestId,
          latency_ms: requestLogs.latencyMs,
          created_at: requestLogs.createdAt,
          env: environments.type,
        })
        .from(requestLogs)
        .innerJoin(environments, eq(environments.id, requestLogs.environmentId))
        .where(
          and(
            keyset,
            opts.applicationId
              ? eq(
                  requestLogs.applicationId,
                  opts.applicationId as ApplicationId,
                )
              : undefined,
            opts.envType ? eq(environments.type, opts.envType) : undefined,
          ),
        )
        .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
        .limit(pageSize + 1),
    );

    const { page, nextCursor } = takePage(rows, pageSize, (r) =>
      encodeCursor(r.created_at.toISOString(), r.id),
    );
    return {
      logs: page.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
      next_cursor: nextCursor,
    };
  }
}

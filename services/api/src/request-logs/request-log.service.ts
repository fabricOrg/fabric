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
import { Inject, Injectable, Logger } from "@nestjs/common";
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
 * Request-log capture + query (W-B). `record()` is FIRE-AND-FORGET off the hot path: it writes via
 * the provisioner connection (no per-request tenant session to set up) and NEVER throws to the caller
 * — a log-store failure must not slow or fail the customer's request (availability posture; opposite
 * of the wallet path). `list()` reads per-tenant through app_runtime (RLS), keyset-paginated.
 */
@Injectable()
export class RequestLogService {
  private readonly logger = new Logger(RequestLogService.name);

  constructor(
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  /** Fire-and-forget: schedules the insert and returns immediately; failures are logged + dropped. */
  record(entry: RequestLogEntry): void {
    void this.provisioning.db
      .insert(requestLogs)
      .values({
        tenantId: entry.tenantId as TenantId,
        applicationId: (entry.applicationId as ApplicationId | null) ?? null,
        environmentId: (entry.environmentId as EnvironmentId | null) ?? null,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        requestId: entry.requestId,
        latencyMs: entry.latencyMs,
        keyId: entry.keyId,
      })
      .catch((error: unknown) => {
        // Logging must never break the API — drop the row and move on.
        this.logger.warn(
          `request-log write dropped: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      });
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

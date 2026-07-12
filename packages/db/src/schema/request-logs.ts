import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  tenantIdCol,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";

/**
 * REQUEST LOGS (W-B) — one row per customer public-API request, for the developer's Logs view. High
 * volume + immutable, so it's deliberately lean: no updated_at, METADATA ONLY (never request/response
 * bodies, never a raw key — only the key's hash prefix). Tenant-scoped -> FORCE RLS; scoped to an
 * application-environment (ADR-0004). Written fire-and-forget off the hot path by the request-log
 * interceptor (via the provisioner connection) and read per-tenant via the query API; a scheduled
 * sweeper deletes rows past the retention window (unbounded logs would be a cost/scale bug).
 */
export const requestLogs = pgTable(
  "request_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .$type<ApplicationId>(),
    environmentId: uuid("environment_id")
      .references(() => environments.id, { onDelete: "cascade" })
      .$type<EnvironmentId>(),
    method: text("method").notNull(), // GET | POST | …
    path: text("path").notNull(), // request path, query string stripped
    statusCode: integer("status_code").notNull(),
    requestId: text("request_id").notNull(), // req_… — ties back to error toasts / support
    latencyMs: integer("latency_ms").notNull(),
    keyId: text("key_id").notNull(), // SHA-256 hash PREFIX of the presenting key — never the raw key
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Keyset pagination + per-app scoping: newest-first within a workspace's application.
    index("idx_request_logs_tenant_app_created").on(
      t.tenantId,
      t.applicationId,
      t.createdAt,
      t.id,
    ),
  ],
);

export type RequestLog = typeof requestLogs.$inferSelect;
export type NewRequestLog = typeof requestLogs.$inferInsert;

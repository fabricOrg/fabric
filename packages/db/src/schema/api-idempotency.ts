import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { type TenantId, timestamps } from "./_shared.js";

/**
 * API IDEMPOTENCY KEYS — client-supplied `Idempotency-Key` header on money POSTs (ARCHITECTURE §7,
 * remediation finding 3). The engine's internal keys (`reserve:{messageId}`) protect INTERNAL
 * retries only — they key on the server-generated id, so a client retry of POST /v1/sms/send
 * (timeout, network blip) would mint a NEW message + NEW reservation = double charge. This table
 * closes that: UNIQUE(tenant_id, key) makes the first request the winner; a retry with the same
 * key + same body replays the stored response; same key + different body is a 409.
 *
 * `fingerprint` = sha256 of the canonical request body — the same-key-same-body proof.
 * `status` pending → completed; a request that FAILS deletes its pending row so the client may
 * safely retry the same key. `expires_at` bounds the store; the maintenance job purges expired
 * rows (keys are a replay window, not an archive).
 *
 * Tenant-scoped, RLS FORCE (raw-SQL migration) — a tenant can never replay another tenant's key.
 */
export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull().default("pending"), // pending | completed
    /** The success response body to replay verbatim (null while pending). */
    response: jsonb("response"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("uniq_api_idempotency_tenant_key").on(t.tenantId, t.key),
    // The maintenance purge scans by expiry only.
    index("idx_api_idempotency_expires").on(t.expiresAt),
  ],
);

export type ApiIdempotencyKey = typeof apiIdempotencyKeys.$inferSelect;
export type NewApiIdempotencyKey = typeof apiIdempotencyKeys.$inferInsert;

import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";

/**
 * API KEYS (F2.3, L2) — developer credentials for the public API. A key authenticates a REQUEST and
 * resolves it to a tenant. Model (Stripe/Twilio): env in the prefix (`sk_test_`/`sk_live_`), HASHED
 * AT REST (`key_hash` = SHA-256 of the raw; the raw is shown once, never stored), `prefix` kept for
 * dashboard display. Tenant-scoped → FORCE RLS (sql/0006_api_keys_rls.sql).
 *
 * The AUTH lookup is inherently cross-tenant (you resolve WHICH tenant owns the presented key). The
 * ratified (B-policy) does this with ZERO SECURITY DEFINER and ZERO BYPASSRLS: a second, SELECT-only
 * RLS policy `api_key_auth_lookup` exposes ONLY the row whose `key_hash` the caller PRESENTS
 * (`USING key_hash = current_setting('app.api_key_hash', true)`), reached via `withApiKeyLookup`.
 * Possession-scoped — you can read a key row iff you hold the raw key. Everything after auth runs via
 * withTenant; management (list/revoke) uses the `tenant_isolation` policy. See sql/0006.
 */

export const apiKeyEnv = pgEnum("api_key_env", ["test", "live"]);
export const apiKeyStatus = pgEnum("api_key_status", ["active", "revoked"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    // ADR-0004: a key belongs to one application-environment. Nullable during the two-step backfill
    // (0047 adds them, the ops backfill points existing keys at the default app's matching env, a
    // follow-up makes them NOT NULL once every writer sets them). New keys always set both.
    applicationId: uuid("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .$type<ApplicationId>(),
    environmentId: uuid("environment_id")
      .references(() => environments.id, { onDelete: "cascade" })
      .$type<EnvironmentId>(),
    name: text("name").notNull().default(""), // human label, e.g. "server prod"
    prefix: text("prefix").notNull(), // e.g. "sk_test_ab3d" — displayed to identify the key
    keyHash: text("key_hash").notNull(), // SHA-256(raw) hex — the only stored representation
    env: apiKeyEnv("env").notNull(),
    scopes: jsonb("scopes").notNull().default([]), // e.g. ["sms:send","wallet:read"]
    status: apiKeyStatus("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Optional expiry (NULL = never). The auth lookup treats a past expires_at like a revoked key,
    // so an expired key stops authenticating without a status change.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  // Array form (drizzle 0.45). The possession-scoped auth lookup rides the key_hash equality index.
  (t) => [
    unique("uniq_api_key_hash").on(t.keyHash),
    index("idx_api_keys_tenant").on(t.tenantId),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "api_keys_application_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "api_keys_environment_application_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

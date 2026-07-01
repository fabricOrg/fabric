import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * API KEYS (F2.3, L2) — developer credentials for the public API. A key authenticates a REQUEST and
 * resolves it to a tenant. Model (Stripe/Twilio): env in the prefix (`sk_test_`/`sk_live_`), HASHED
 * AT REST (`key_hash` = SHA-256 of the raw; the raw is shown once, never stored), `prefix` kept for
 * dashboard display. Tenant-scoped → FORCE RLS (management: list/revoke stay tenant-scoped, sql/0003).
 *
 * The AUTH lookup is inherently cross-tenant (you resolve WHICH tenant owns the presented key), so it
 * cannot run inside a tenant context — it goes through the single `SECURITY DEFINER resolve_api_key`
 * (sql/0003), the ONE sanctioned RLS-bypass (PRE-IMPL B4). Everything after auth runs via withTenant.
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
    name: text("name").notNull().default(""), // human label, e.g. "server prod"
    prefix: text("prefix").notNull(), // e.g. "sk_test_ab3d" — displayed to identify the key
    keyHash: text("key_hash").notNull(), // SHA-256(raw) hex — the only stored representation
    env: apiKeyEnv("env").notNull(),
    scopes: jsonb("scopes").notNull().default([]), // e.g. ["sms:send","wallet:read"]
    status: apiKeyStatus("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // global-unique hash: the resolver looks a key up by key_hash equality (indexed) across tenants.
    uniqKeyHash: unique("uniq_api_key_hash").on(t.keyHash),
    byTenant: index("idx_api_keys_tenant").on(t.tenantId),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

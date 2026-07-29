import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * INTEGRATION PLUGINS — PLATFORM-level provider registry (see docs/INTEGRATIONS-PLUGIN-ARCHITECTURE.md).
 * Staff enable/configure provider *instances* in the control plane; the product resolves + routes
 * through whatever is enabled. This is GLOBAL platform config, not tenant data — so no tenant_id and
 * no RLS (it is not a tenant table). Credentials live in Vault; only a reference is stored here.
 * enable/disable + a default + fallback order (priority; 0 = primary) drive routing per capability.
 */

export const pluginCapability = pgEnum("plugin_capability", [
  "sms",
  "email",
  "whatsapp",
  "payment",
  "identity",
]);
export const pluginMode = pgEnum("plugin_mode", ["sandbox", "live"]);
export const pluginInstanceStatus = pgEnum("plugin_instance_status", [
  "connected",
  "available",
  "error",
]);

export const pluginInstances = pgTable(
  "plugin_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * NULL = platform-wide (the normal case). A tenant id scopes the instance to one workspace, so
     * a customer can eventually bring their own carrier account without another migration
     * (ADR-0011 §2). Still platform config reached only through the provisioning connection — this
     * column does NOT make plugin_instances a tenant table and there is no RLS policy on it.
     *
     * RESTRICT, matching the ledger: deleting a workspace must not silently shred routing config.
     */
    tenantId: uuid("tenant_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    capability: pluginCapability("capability").notNull(),
    vendor: text("vendor").notNull(), // plugin TYPE, e.g. "paystack", "africas-talking"
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    mode: pluginMode("mode").notNull().default("sandbox"),
    status: pluginInstanceStatus("status").notNull().default("available"),
    priority: integer("priority").notNull().default(100), // ascending; 0 = primary, then fallbacks
    /**
     * The ACTIVE credential row (ADR-0011 §1) — never the secret itself.
     *
     * A real uuid FK, not free text: rotation keeps superseded versions around to be pruned later,
     * and SET NULL turns a pruned-away credential into the honest "not configured" state instead of
     * a dangling id that resolves to nothing at send time. Typing it also lets reads join the
     * fingerprint directly (text vs uuid has no equality operator in Postgres).
     */
    credentialsRef: uuid("credentials_ref").references(
      (): AnyPgColumn => pluginCredentials.id,
      { onDelete: "set null" },
    ),
    ...timestamps,
  },
  (t) => [
    /**
     * ADR-0011 §2. The old `unique(capability, vendor)` forbade the cases the product needs: a
     * sandbox AND a live Arkesel instance side by side, and two accounts with one vendor.
     *
     * NULLS NOT DISTINCT is load-bearing (PG15+). Postgres normally treats NULLs as distinct, so a
     * plain UNIQUE over a nullable tenant_id would let unlimited DUPLICATE platform-wide rows in —
     * the exact collisions this constraint exists to stop, silently allowed for the most common
     * row shape. With it, two platform-wide sms/arkesel/live rows conflict as intended.
     */
    unique("uniq_plugin_instance")
      .on(t.tenantId, t.capability, t.vendor, t.mode)
      .nullsNotDistinct(),
    index("idx_plugin_instances_capability").on(t.capability),
  ],
);

export type PluginInstanceRow = typeof pluginInstances.$inferSelect;
export type NewPluginInstance = typeof pluginInstances.$inferInsert;

/**
 * PLUGIN CREDENTIALS (ADR-0011) — the encrypted secrets a plugin instance needs to reach its vendor.
 *
 * Same envelope shape as the PII vault: a per-credential DEK wrapped under the platform master key,
 * with the secret encrypted under that DEK rather than under the master key directly. Revoking one
 * provider is then destroying one wrapped DEK, not re-encrypting every other integration.
 *
 * Rotation INSERTs a new version and repoints `plugin_instances.credentials_ref`, so the superseded
 * row survives until it is pruned — a bad rotation is recoverable, and the AAD binds each ciphertext
 * to its version so an old blob cannot be replayed against the new record.
 *
 * Platform config, not tenant data: no tenant_id, no RLS, reachable only through the provisioning
 * connection. The plaintext NEVER leaves this table — reads expose `fingerprint` only, which
 * identifies which key is installed without revealing any of it.
 */
export const pluginCredentials = pgTable(
  "plugin_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pluginInstanceId: uuid("plugin_instance_id")
      .notNull()
      .references(() => pluginInstances.id, { onDelete: "cascade" }),
    /** Monotonic per instance. Part of the AAD, so versions are not interchangeable. */
    version: integer("version").notNull().default(1),
    /** The DEK, sealed under the platform master key. NULL = revoked; the secret is unreadable. */
    dekWrapped: bytea("dek_wrapped"),
    /** The credential document (JSON) sealed under the DEK. */
    ciphertext: bytea("ciphertext").notNull(),
    /** Non-reversible marker so staff can tell WHICH key is installed. Never the secret itself. */
    fingerprint: text("fingerprint").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("uniq_plugin_credential_version").on(t.pluginInstanceId, t.version),
    index("idx_plugin_credentials_instance").on(t.pluginInstanceId),
  ],
);

export type PluginCredentialRow = typeof pluginCredentials.$inferSelect;
export type NewPluginCredential = typeof pluginCredentials.$inferInsert;

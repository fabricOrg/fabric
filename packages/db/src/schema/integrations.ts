import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared.js";

/**
 * INTEGRATION PLUGINS — PLATFORM-level provider registry (see docs/INTEGRATIONS-PLUGIN-ARCHITECTURE.md).
 * Staff enable/configure provider *instances* in the control plane; the product resolves + routes
 * through whatever is enabled. This is GLOBAL platform config, not tenant data — so no tenant_id and
 * no RLS (it is not a tenant table). Credentials live in Vault; only a reference is stored here.
 * enable/disable + a default + fallback order (priority; 0 = primary) drive routing per capability.
 */

export const pluginCapability = pgEnum("plugin_capability", [
  "sms",
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
    capability: pluginCapability("capability").notNull(),
    vendor: text("vendor").notNull(), // plugin TYPE, e.g. "paystack", "africas-talking"
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    mode: pluginMode("mode").notNull().default("sandbox"),
    status: pluginInstanceStatus("status").notNull().default("available"),
    priority: integer("priority").notNull().default(100), // ascending; 0 = primary, then fallbacks
    credentialsRef: text("credentials_ref"), // Vault key — never the raw secret
    ...timestamps,
  },
  (t) => [
    unique("uniq_plugin_instance").on(t.capability, t.vendor),
    index("idx_plugin_instances_capability").on(t.capability),
  ],
);

export type PluginInstanceRow = typeof pluginInstances.$inferSelect;
export type NewPluginInstance = typeof pluginInstances.$inferInsert;

import { boolean, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * KILL SWITCHES — circuit breakers staff flip during incidents (pause all SMS, disable a provider,
 * halt payments…). `enabled` = the capability is OPERATIONAL; flipping to false PAUSES it. Runtime
 * paths (send/charge) check the relevant key before acting, and every toggle records the actor +
 * reason to the audit log.
 *
 * Reached ONLY through the provisioning connection: `app_runtime` was REVOKEd in 0132, which is what
 * protects this table — it has no RLS policy, and `tenant_id` below is a SCOPE, never a boundary.
 * (The comment this file used to carry cited `plugin_instances` as the precedent for being safe
 * while that table was itself a hole. Ask Postgres, not a comment.)
 */
export const killSwitches = pgTable(
  "kill_switches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(), // stable id, e.g. "platform.sms_sending"
    /**
     * NULL = the PLATFORM breaker for this key (the incident control staff already had). A tenant id
     * scopes the same key to one workspace, so one abusive sender can be paused without halting
     * every tenant.
     *
     * Precedence lives in the service, not here: a capability is paused when the platform row OR the
     * tenant row says so, so a tenant override can PAUSE but never RESUME past a platform halt.
     *
     * CASCADE, unlike `plugin_instances.tenant_id` (RESTRICT): routing config is worth protecting
     * from a workspace deletion, but a per-tenant breaker is incident state for a tenant that no
     * longer exists.
     */
    tenantId: uuid("tenant_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    description: text("description").notNull(),
    scope: text("scope").notNull().default("platform"), // platform | provider | payments
    enabled: boolean("enabled").notNull().default(true), // true = operational; false = PAUSED
    lastReason: text("last_reason"),
    lastActorEmail: text("last_actor_email"),
    ...timestamps,
  },
  (t) => [
    /**
     * NULLS NOT DISTINCT is load-bearing (PG15+), the same reason `uniq_plugin_instance` needs it:
     * Postgres treats NULLs as distinct, so a plain `unique(key, tenant_id)` would let UNLIMITED
     * duplicate PLATFORM rows in for one key — several contradictory answers to "is SMS paused?",
     * silently allowed for the most common row shape. With it, one platform row and at most one
     * override per (key, tenant).
     */
    unique("uniq_kill_switch_key_tenant")
      .on(t.key, t.tenantId)
      .nullsNotDistinct(),
  ],
);

export type KillSwitch = typeof killSwitches.$inferSelect;
export type NewKillSwitch = typeof killSwitches.$inferInsert;

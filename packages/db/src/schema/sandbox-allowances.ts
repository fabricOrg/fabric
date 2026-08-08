import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
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
 * One lazily-created UTC-day counter per workspace and channel.
 *
 * CASCADE, not restrict. These are derived, expiring operational counters — nothing here is a record
 * worth refusing a deletion to protect. Under `restrict` a workspace could not be deleted because
 * someone sent a test message weeks ago, which blocked closure and GDPR erasure alike, and there is
 * no prune to clear them first. Contrast plugin_instances, where restrict is deliberate: a sealed
 * credential IS something a careless delete should trip over.
 */
export const sandboxUsageBuckets = pgTable(
  "sandbox_usage_buckets",
  {
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    channel: text("channel").notNull(),
    usedUnits: bigint("used_units", { mode: "bigint" }).notNull(),
    dailyLimit: bigint("daily_limit", { mode: "bigint" }).notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.usageDate, t.channel],
      name: "sandbox_usage_buckets_pk",
    }),
    check(
      "sandbox_usage_buckets_channel_chk",
      sql`${t.channel} in ('sms', 'email', 'whatsapp')`,
    ),
    check("sandbox_usage_buckets_used_chk", sql`${t.usedUnits} >= 0`),
    check("sandbox_usage_buckets_limit_chk", sql`${t.dailyLimit} > 0`),
    check(
      "sandbox_usage_buckets_ceiling_chk",
      sql`${t.usedUnits} <= ${t.dailyLimit}`,
    ),
  ],
);

/** Immutable idempotency evidence for every sandbox allowance consumption. */
export const sandboxUsageEvents = pgTable(
  "sandbox_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id").$type<ApplicationId>(),
    environmentId: uuid("environment_id").$type<EnvironmentId>(),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    channel: text("channel").notNull(),
    referenceId: uuid("reference_id").notNull(),
    units: bigint("units", { mode: "bigint" }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("uniq_sandbox_usage_reference").on(
      t.tenantId,
      t.channel,
      t.referenceId,
    ),
    index("idx_sandbox_usage_events_tenant_day").on(
      t.tenantId,
      t.usageDate,
      t.channel,
    ),
    check(
      "sandbox_usage_events_channel_chk",
      sql`${t.channel} in ('sms', 'email', 'whatsapp')`,
    ),
    check("sandbox_usage_events_units_chk", sql`${t.units} > 0`),
    check(
      "sandbox_usage_events_context_chk",
      sql`(${t.applicationId} IS NULL AND ${t.environmentId} IS NULL)
        OR (${t.applicationId} IS NOT NULL AND ${t.environmentId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "sandbox_usage_events_application_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "sandbox_usage_events_environment_application_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export type SandboxUsageBucket = typeof sandboxUsageBuckets.$inferSelect;
export type SandboxUsageEvent = typeof sandboxUsageEvents.$inferSelect;

import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  moneyMinor,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";
import {
  messageDefinitions,
  messageDefinitionVersions,
} from "./message-definitions.js";
import { messages } from "./sms.js";

export const messageDeliveries = pgTable(
  "message_deliveries",
  {
    id: uuid("id").primaryKey(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    applicationId: uuid("application_id").notNull().$type<ApplicationId>(),
    environmentId: uuid("environment_id").notNull().$type<EnvironmentId>(),
    definitionId: uuid("definition_id").notNull(),
    versionId: uuid("version_id").notNull(),
    key: text("key").notNull(),
    locale: text("locale").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("accepted"),
    resourceVersion: integer("resource_version").notNull().default(1),
    reference: text("reference"),
    metadata: jsonb("metadata").notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    maxCostMinor: moneyMinor("max_cost_minor"),
    totalCostMinor: moneyMinor("total_cost_minor").notNull().default(sql`0`),
    legalHold: boolean("legal_hold").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uniq_message_delivery_idempotency").on(
      table.tenantId,
      table.applicationId,
      table.environmentId,
      table.idempotencyKey,
    ),
    uniqueIndex("uniq_message_delivery_id_tenant_app_env").on(
      table.id,
      table.tenantId,
      table.applicationId,
      table.environmentId,
    ),
    index("idx_message_deliveries_tenant_created").on(
      table.tenantId,
      table.createdAt,
    ),
    index("idx_message_deliveries_retention")
      .on(table.expiresAt)
      .where(sql`legal_hold = false`),
    check("message_delivery_channel_check", sql`${table.channel} = 'sms'`),
    check(
      "message_delivery_status_check",
      sql`${table.status} IN ('accepted', 'processing', 'sent', 'delivered', 'undelivered', 'failed', 'expired')`,
    ),
    check(
      "message_delivery_resource_version_check",
      sql`${table.resourceVersion} > 0`,
    ),
    check(
      "message_delivery_cost_check",
      sql`${table.totalCostMinor} >= 0 AND (${table.maxCostMinor} IS NULL OR ${table.maxCostMinor} >= 0)`,
    ),
    check(
      "message_delivery_idempotency_length_check",
      sql`length(${table.idempotencyKey}) BETWEEN 1 AND 255`,
    ),
    check(
      "message_delivery_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "message_delivery_metadata_object_check",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    foreignKey({
      columns: [table.applicationId, table.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "message_delivery_application_containment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.environmentId, table.applicationId, table.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "message_delivery_environment_containment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.definitionId, table.tenantId, table.applicationId],
      foreignColumns: [
        messageDefinitions.id,
        messageDefinitions.tenantId,
        messageDefinitions.applicationId,
      ],
      name: "message_delivery_definition_containment_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.versionId, table.tenantId, table.definitionId],
      foreignColumns: [
        messageDefinitionVersions.id,
        messageDefinitionVersions.tenantId,
        messageDefinitionVersions.definitionId,
      ],
      name: "message_delivery_version_containment_fk",
    }).onDelete("restrict"),
  ],
);

export const messageDeliveryAttempts = pgTable(
  "message_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    applicationId: uuid("application_id").notNull().$type<ApplicationId>(),
    environmentId: uuid("environment_id").notNull().$type<EnvironmentId>(),
    deliveryId: uuid("delivery_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    channel: text("channel").notNull(),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("accepted"),
    costMinor: moneyMinor("cost_minor").notNull().default(sql`0`),
    currency: char("currency", { length: 3 }).notNull(),
    errorCode: text("error_code"),
    providerAcceptedAt: timestamp("provider_accepted_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uniq_message_delivery_attempt_ordinal").on(
      table.deliveryId,
      table.ordinal,
    ),
    uniqueIndex("uniq_message_delivery_attempt_message").on(table.messageId),
    index("idx_message_delivery_attempts_delivery").on(
      table.tenantId,
      table.deliveryId,
    ),
    check("message_delivery_attempt_ordinal_check", sql`${table.ordinal} > 0`),
    check(
      "message_delivery_attempt_channel_check",
      sql`${table.channel} = 'sms'`,
    ),
    check(
      "message_delivery_attempt_status_check",
      sql`${table.status} IN ('accepted', 'processing', 'sent', 'delivered', 'undelivered', 'failed', 'expired')`,
    ),
    check("message_delivery_attempt_cost_check", sql`${table.costMinor} >= 0`),
    foreignKey({
      columns: [
        table.deliveryId,
        table.tenantId,
        table.applicationId,
        table.environmentId,
      ],
      foreignColumns: [
        messageDeliveries.id,
        messageDeliveries.tenantId,
        messageDeliveries.applicationId,
        messageDeliveries.environmentId,
      ],
      name: "message_delivery_attempt_containment_fk",
    }).onDelete("restrict"),
  ],
);

export type MessageDelivery = typeof messageDeliveries.$inferSelect;
export type MessageDeliveryAttempt =
  typeof messageDeliveryAttempts.$inferSelect;

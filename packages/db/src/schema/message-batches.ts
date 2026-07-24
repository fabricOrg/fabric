import {
  foreignKey,
  index,
  integer,
  pgTable,
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
import { messages } from "./sms.js";

export const messageBatches = pgTable(
  "message_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" })
      .$type<ApplicationId>(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "restrict" })
      .$type<EnvironmentId>(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("processing"),
    totalCount: integer("total_count").notNull(),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("uniq_message_batch_environment_key").on(
      t.tenantId,
      t.environmentId,
      t.idempotencyKey,
    ),
    unique("uniq_message_batch_id_tenant").on(t.id, t.tenantId),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "message_batches_application_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "message_batches_environment_application_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const messageBatchItems = pgTable(
  "message_batch_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => messageBatches.id, { onDelete: "cascade" }),
    clientReference: text("client_reference").notNull(),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (t) => [
    unique("uniq_message_batch_item_reference").on(
      t.batchId,
      t.clientReference,
    ),
    index("idx_message_batch_items_batch").on(t.batchId, t.id),
    foreignKey({
      columns: [t.batchId, t.tenantId],
      foreignColumns: [messageBatches.id, messageBatches.tenantId],
      name: "message_batch_items_batch_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.messageId, t.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
      name: "message_batch_items_message_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export type MessageBatch = typeof messageBatches.$inferSelect;
export type MessageBatchItem = typeof messageBatchItems.$inferSelect;

import { sql } from "drizzle-orm";
import { check, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";

/** Tenant-owned reusable SMS content. RLS is installed by the sibling raw migration. */
export const smsTemplates = pgTable(
  "sms_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    messageClass: text("message_class").notNull().default("transactional"),
    ...timestamps,
  },
  (table) => [
    unique("uniq_sms_templates_tenant_name").on(table.tenantId, table.name),
    check(
      "sms_templates_message_class_check",
      sql`${table.messageClass} IN ('transactional', 'promotional')`,
    ),
    check(
      "sms_templates_name_length_check",
      sql`char_length(${table.name}) BETWEEN 1 AND 80`,
    ),
    check(
      "sms_templates_body_length_check",
      sql`char_length(${table.body}) BETWEEN 1 AND 1600`,
    ),
  ],
);

export type SmsTemplateRow = typeof smsTemplates.$inferSelect;

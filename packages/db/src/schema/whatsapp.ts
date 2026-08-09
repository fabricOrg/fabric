import { sql } from "drizzle-orm";
import {
  bigint,
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
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";
import type { PricingSnapshot } from "./pricing.js";
import { dataSubjects, piiVault } from "./privacy.js";
import { messageStatus } from "./sms.js";

export const whatsappMessages = pgTable(
  "whatsapp_messages",
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
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => dataSubjects.subjectId, { onDelete: "restrict" }),
    contentPiiId: uuid("content_pii_id").references(() => piiVault.id, {
      onDelete: "set null",
    }),
    // NO recipient column, deliberately — `subject_id` above IS the recipient, as a surrogate. The raw
    // wa_id/E.164 lives in `pii_vault` and nowhere else, matching `messages` ("only encrypted-vault
    // references live on the message, never raw recipient/body" — sms.ts:132) and `email_messages`,
    // which likewise has none. A plaintext copy here would survive PII erasure: `pii-erasure.service.ts`
    // clears the vault, so an erasure request would silently leave the phone number behind on this row.
    templateName: text("template_name"),
    templateLanguage: text("template_language"),
    templateCategory: text("template_category"),
    status: messageStatus("status").notNull().default("queued"),
    statusRank: integer("status_rank").notNull().default(0),
    backing: text("backing").notNull().default("wallet"),
    providerSlug: text("provider_slug").notNull().default("sandbox-whatsapp"),
    providerRef: text("provider_ref"),
    errorCode: text("error_code"),
    costMinor: bigint("cost_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currency: char("currency", { length: 3 }).notNull().default("GHS"),
    pricingSnapshot: jsonb("pricing_snapshot").$type<PricingSnapshot>(),
    ...timestamps,
  },
  (t) => [
    check(
      "whatsapp_messages_template_category_chk",
      sql`${t.templateCategory} IS NULL OR ${t.templateCategory} in ('marketing', 'utility', 'authentication', 'service')`,
    ),
    check(
      "whatsapp_messages_backing_chk",
      sql`${t.backing} in ('wallet', 'tokens', 'sandbox_allowance')`,
    ),
    index("idx_whatsapp_messages_environment_created").on(
      t.tenantId,
      t.environmentId,
      t.createdAt,
      t.id,
    ),
    uniqueIndex("uniq_whatsapp_messages_provider_ref")
      .on(t.providerSlug, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "whatsapp_messages_application_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "whatsapp_messages_environment_application_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    wabaId: text("waba_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    status: text("status").notNull(),
    qualityRating: text("quality_rating"),
    components: jsonb("components").notNull().default(sql`'[]'::jsonb`),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    statusUpdatedAt: timestamp("status_updated_at", {
      withTimezone: true,
    }).notNull(),
    qualityUpdatedAt: timestamp("quality_updated_at", {
      withTimezone: true,
    }).notNull(),
    categoryUpdatedAt: timestamp("category_updated_at", {
      withTimezone: true,
    }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uniq_whatsapp_templates_waba_name_language").on(
      t.wabaId,
      t.name,
      t.language,
    ),
    index("idx_whatsapp_templates_tenant_synced").on(t.tenantId, t.syncedAt),
  ],
);

export const whatsappDispatches = pgTable(
  "whatsapp_dispatches",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => whatsappMessages.id, { onDelete: "cascade" }),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").notNull().default("pending"),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    check(
      "whatsapp_dispatches_status_chk",
      sql`${t.status} in ('pending', 'sending', 'failed')`,
    ),
    index("idx_whatsapp_dispatches_pending")
      .on(t.availableAt, t.messageId)
      .where(sql`completed_at IS NULL AND status = 'pending'`),
  ],
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type WhatsappDispatch = typeof whatsappDispatches.$inferSelect;

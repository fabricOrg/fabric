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

export const emailMessages = pgTable(
  "email_messages",
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
    status: messageStatus("status").notNull().default("queued"),
    statusRank: integer("status_rank").notNull().default(0),
    backing: text("backing").notNull().default("wallet"),
    providerSlug: text("provider_slug").notNull().default("sandbox-email"),
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
      "email_messages_backing_chk",
      sql`${t.backing} in ('wallet', 'tokens', 'sandbox_allowance')`,
    ),
    index("idx_email_messages_environment_created").on(
      t.tenantId,
      t.environmentId,
      t.createdAt,
      t.id,
    ),
    uniqueIndex("uniq_email_messages_provider_ref")
      .on(t.providerSlug, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "email_messages_application_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "email_messages_environment_application_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export const emailDispatches = pgTable(
  "email_dispatches",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("idx_email_dispatches_pending")
      .on(t.availableAt, t.messageId)
      .where(sql`completed_at IS NULL`),
  ],
);

export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailDispatch = typeof emailDispatches.$inferSelect;

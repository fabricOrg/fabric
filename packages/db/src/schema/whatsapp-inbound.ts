import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
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
import { dataSubjects, piiVault } from "./privacy.js";

/**
 * WhatsApp INBOUND (ADR-0015). Split from whatsapp.ts for the file-length guard.
 *
 * Attribution is the whole problem here. Meta delivers an inbound message to the shared WABA, and the
 * payload says which consumer wrote and which WABA number they wrote to — never which of our tenants
 * it is for. ADR-0015 §1 resolves it to the tenant of the most recent OUTBOUND to that consumer inside
 * the service window, and records anything it cannot resolve as unattributed rather than guessing.
 */

export const whatsappInboundMessages = pgTable(
  "whatsapp_inbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    // Carried from the outbound message that won attribution — an inbound belongs to the same
    // application/environment as the conversation it is a reply within, not to a default.
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" })
      .$type<ApplicationId>(),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "restrict" })
      .$type<EnvironmentId>(),
    // The SENDER, as a surrogate. No plaintext number column, deliberately — same rule as
    // whatsapp_messages: a plaintext copy survives PII erasure, which clears the vault and knows
    // nothing about a column added later.
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => dataSubjects.subjectId, { onDelete: "restrict" }),
    contentPiiId: uuid("content_pii_id").references(() => piiVault.id, {
      onDelete: "set null",
    }),
    // Meta's `wamid`. The idempotency key for ingestion: Meta retries a webhook it believes failed,
    // and a retry must not create a second row, event, or window extension (ADR-0015 §5).
    providerRef: text("provider_ref").notNull(),
    messageType: text("message_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uniq_whatsapp_inbound_provider_ref").on(
      t.tenantId,
      t.providerRef,
    ),
    index("idx_whatsapp_inbound_tenant_received").on(t.tenantId, t.receivedAt),
    index("idx_whatsapp_inbound_subject").on(t.tenantId, t.subjectId),
  ],
);

/**
 * The 24-hour customer service window, one row per (tenant, consumer). STORED rather than derived from
 * the newest inbound row (ADR-0015 §6): the send path must consult it before allowing a free-form
 * message, and that check belongs on the hot path as one indexed read rather than an aggregate over a
 * table that only grows.
 */
export const whatsappServiceWindows = pgTable(
  "whatsapp_service_windows",
  {
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => dataSubjects.subjectId, { onDelete: "restrict" }),
    lastInboundAt: timestamp("last_inbound_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.subjectId] }),
    index("idx_whatsapp_service_windows_expiry").on(t.tenantId, t.expiresAt),
    check(
      "whatsapp_service_window_expiry_chk",
      sql`${t.expiresAt} > ${t.lastInboundAt}`,
    ),
  ],
);

/**
 * Inbound Meta could not attribute to any tenant — nobody had messaged that consumer inside the
 * window (ADR-0015 §1). CONTROL PLANE: no tenant, therefore no RLS and no tenant-facing access.
 *
 * It records that a message arrived and nothing about who sent it. There is no tenant to scope a vault
 * subject to, so there is nowhere lawful to put the consumer's number — and a steady rate of these
 * rows is the evidence for moving to per-tenant numbers, which needs a COUNT, not a phone book.
 */
export const whatsappUnattributedInbound = pgTable(
  "whatsapp_unattributed_inbound",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Meta's `wamid` — carried only so a webhook retry does not double-count. */
    providerRef: text("provider_ref").notNull(),
    /** The WABA number the consumer wrote to. Ours, not theirs. */
    phoneNumberId: text("phone_number_id").notNull(),
    messageType: text("message_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uniq_whatsapp_unattributed_provider_ref").on(t.providerRef),
    index("idx_whatsapp_unattributed_received").on(t.receivedAt),
  ],
);

export type WhatsappInboundMessage =
  typeof whatsappInboundMessages.$inferSelect;
export type WhatsappServiceWindow = typeof whatsappServiceWindows.$inferSelect;
export type WhatsappUnattributedInbound =
  typeof whatsappUnattributedInbound.$inferSelect;

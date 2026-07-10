import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";

/**
 * SENDER-ID registry (E10, COMPETITIVE-ANALYSIS C-2). In Nigeria an unregistered sender id is
 * REJECTED by the carrier — registration status is a delivery gate, not metadata. Tenant-scoped
 * (RLS in the sibling raw migration). Status is decided by staff/ops after carrier/NCC review;
 * the send path enforces `active` for LIVE tenants (sandbox rides the fake provider and skips
 * this — see SmsService).
 */

export const senderStatus = pgEnum("sender_status", [
  "pending",
  "active",
  "rejected",
]);

export const senders = pgTable(
  "senders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol(),
    // Alphanumeric sender ids are capped at 11 chars by GSM; validated at the contract boundary.
    senderId: text("sender_id").notNull(),
    country: text("country").notNull(), // ISO-3166 alpha-2, e.g. GH / NG
    type: text("type").notNull().default("alphanumeric"),
    useCase: text("use_case").notNull(),
    status: senderStatus("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One registration per (tenant, sender id, country) — resubmission edits the row's status.
    unique("uniq_sender_tenant_id_country").on(
      t.tenantId,
      t.senderId,
      t.country,
    ),
  ],
);

export type Sender = typeof senders.$inferSelect;

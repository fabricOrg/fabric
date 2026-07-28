import { sql } from "drizzle-orm";
import {
  check,
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

/**
 * The CARRIER side of a registration — internal to staff, never shown to the customer.
 *
 * It exists because the carrier is the real gate and we cannot automate it: Arkesel exposes no
 * sender-ID registration endpoint (v2 is send / DLR / OTP / contacts / balance), so registration is
 * an operator action in their dashboard plus network-level operator approval. Without this column
 * `status = 'active'` was a claim nothing backed — the carrier would then reject the send with
 * PROHIBITED (mapped to `failed`), the reservation refunded, and the customer saw an "active" sender
 * that could not deliver.
 *
 * `submitted` is the honest in-between: we have asked the carrier and are waiting. The customer sees
 * only their own `status` (pending → active/rejected) and never this vocabulary.
 */
export const senderCarrierStatus = pgEnum("sender_carrier_status", [
  "unregistered",
  "submitted",
  "approved",
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
    // STAFF-ONLY from here down — excluded from the customer-facing DTO by contract, not by luck.
    carrierStatus: senderCarrierStatus("carrier_status")
      .notNull()
      .default("unregistered"),
    /** The carrier's own reference for the registration, when it gives one. Free text: Arkesel has
     * no registration API, so this is whatever an operator can record to make the claim auditable. */
    carrierRef: text("carrier_ref"),
    carrierDecidedAt: timestamp("carrier_decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One registration per (tenant, sender id, country) — resubmission edits the row's status.
    unique("uniq_sender_tenant_id_country").on(
      t.tenantId,
      t.senderId,
      t.country,
    ),
    /**
     * The load-bearing invariant: a sender may only be `active` once the CARRIER approved it.
     *
     * A constraint rather than a service check, because "approved in Fabric" silently meaning
     * "will actually deliver" is exactly the defect this column exists to kill — and a service
     * guard can be bypassed by a migration, a fixture, a staff script, or the next code path
     * someone adds. The database refuses to hold the lie at all.
     */
    check(
      "sender_active_requires_carrier_approval",
      sql`${t.status} <> 'active' OR ${t.carrierStatus} = 'approved'`,
    ),
  ],
);

export type Sender = typeof senders.$inferSelect;

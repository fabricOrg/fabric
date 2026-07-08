import { sql } from "drizzle-orm";
import {
  char,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * Lighthouse flow record — one reconciled verify → charge → notify transaction, keyed by
 * `correlation_id` (unique per tenant → idempotent replays). Tenant-scoped (RLS FORCE, see the
 * companion RLS migration). `charge_entries` stores the double-entry legs as recorded for the
 * explorer; the real ledger movement is posted via @app/wallet on confirm.
 */
export const flowRecords = pgTable(
  "flow_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull().default("pending"), // pending | complete | failed
    customer: text("customer").notNull(), // masked E.164
    channel: text("channel").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    // OTP hash held between start + confirm; cleared once verified. Never the raw code.
    otpHash: text("otp_hash"),
    verifyStatus: text("verify_status").notNull().default("pending"),
    verificationId: text("verification_id"),
    verifyAt: timestamp("verify_at", { withTimezone: true }),
    chargeStatus: text("charge_status").notNull().default("pending"),
    chargeAt: timestamp("charge_at", { withTimezone: true }),
    chargeEntries: jsonb("charge_entries").notNull().default(sql`'[]'::jsonb`),
    notifyStatus: text("notify_status").notNull().default("pending"),
    notifyMessageId: text("notify_message_id"),
    notifyAt: timestamp("notify_at", { withTimezone: true }),
    auditActor: text("audit_actor").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uniq_flow_corr").on(t.tenantId, t.correlationId),
    index("idx_flow_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

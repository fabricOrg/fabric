import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";

/**
 * VERIFY domain (V1, ADR-0002 golden path) — one row per OTP verification. Tenant-scoped (RLS in
 * the sibling raw migration). PII posture mirrors `messages`: the raw E.164 never lands here —
 * `msisdn_hash` (sha-256) is the throttle/aggregation key and `msisdn_masked` is the display form.
 * Billing rides the SMS send: `message_id` links to the messages row whose reserve/commit ledger
 * entries ARE the verification's cost (idempotent on the message id).
 */

export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "verified",
  "failed",
  "expired",
]);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol(),
    msisdnHash: text("msisdn_hash").notNull(),
    msisdnMasked: text("msisdn_masked").notNull(),
    channel: text("channel").notNull().default("sms"),
    // sha256(code : id : salt) — the plaintext code is never stored.
    codeHash: text("code_hash").notNull(),
    codeSalt: text("code_salt").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // The SMS carrying the code — its ledger entries are the verification's billing record.
    messageId: uuid("message_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Resend throttle + per-number funnel queries: latest verification for a number, per tenant.
    index("idx_verifications_tenant_msisdn").on(
      t.tenantId,
      t.msisdnHash,
      t.createdAt,
    ),
  ],
);

export type Verification = typeof verifications.$inferSelect;

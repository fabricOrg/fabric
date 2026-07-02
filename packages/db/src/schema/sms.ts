import { sql } from "drizzle-orm";
import {
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * SMS domain (L5) — the `messages` table: one row per send, the spine of the walking skeleton.
 * Tenant-scoped (RLS, see sql/0003). References a `subject_id` surrogate for the recipient — the raw
 * E.164 lives only in pii_vault (privacy schema), never here.
 *
 * MONEY LINKAGE: `id` is the ledger reference_id — reserve/commit/refund txns key off it
 * (reserve:{id} / commit:{id} / refund:{id}). `cost_minor` is the reserved estimate. The message-row
 * `status` + `status_rank` are the PRIMARY B6 resolution guard (terminal-freeze + monotonic,
 * FOR UPDATE in the DLR handler and sweeper); the ledger's uniq_ledger_txn_resolution_per_message
 * partial index is the DB backstop.
 */

// Mirrors @app/contracts `messageStatus` (F5.3, 8-state). Kept in sync manually (a pg enum can't
// import a zod enum); adams' status-parity gate can assert equality with @app/contracts.
export const messageStatus = pgEnum("message_status", [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
]);

export const messageEncoding = pgEnum("message_encoding", ["gsm7", "ucs2"]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // F4: RESTRICT — never cascade-delete send history with an account (soft-close only).
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    // recipient PII surrogate — raw number lives in pii_vault; nullable in the thin thread.
    subjectId: uuid("subject_id"),
    senderId: text("sender_id").notNull(),
    status: messageStatus("status").notNull().default("queued"),
    // monotonic rank of `status` (STATUS_RANK) — the out-of-order-DLR guard (F5.4): a DLR whose rank
    // is not greater than the recorded one, or that arrives after a terminal, never regresses status.
    statusRank: integer("status_rank").notNull().default(0),
    encoding: messageEncoding("encoding").notNull(),
    segments: integer("segments").notNull(),
    // reserved/charged cost (minor units) — the amount reserve/commit/refund move.
    costMinor: moneyMinor("cost_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    providerSlug: text("provider_slug"),
    // provider's message id — set once the provider acknowledges (accepted); the DLR correlation key.
    providerRef: text("provider_ref"),
    errorCode: text("error_code"),
    ...timestamps,
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    index("idx_messages_tenant_created").on(t.tenantId, t.createdAt),
    // provider_ref must be unique per provider so a DLR maps to exactly one message (dedup + B2).
    // Partial (provider_ref set only once acknowledged) — also serves the reconcile lookup.
    uniqueIndex("uniq_messages_provider_ref")
      .on(t.providerSlug, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

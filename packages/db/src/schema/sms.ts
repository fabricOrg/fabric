import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  moneyMinor,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";
import type { PricingSnapshot } from "./pricing.js";
import { piiVault } from "./privacy.js";

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
    applicationId: uuid("application_id")
      .references(() => applications.id, { onDelete: "restrict" })
      .$type<ApplicationId>(),
    environmentId: uuid("environment_id")
      .references(() => environments.id, { onDelete: "restrict" })
      .$type<EnvironmentId>(),
    // recipient PII surrogate — raw number lives in pii_vault; nullable in the thin thread.
    subjectId: uuid("subject_id"),
    bodyPiiId: uuid("body_pii_id").references(() => piiVault.id, {
      onDelete: "set null",
    }),
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
    // What paid for this send (ADR-0010 Phase 2). 'wallet' = money reserved in the ledger;
    // 'tokens' = a count-based entitlement held in token_holds. Resolution MUST branch on this so a
    // token-backed send settles tokens and a wallet-backed one settles money — never both. Defaults
    // to 'wallet', which is correct for every row that existed before tokens.
    backing: text("backing").notNull().default("wallet"),
    deliveryMode: text("delivery_mode").notNull().default("live"),
    providerSlug: text("provider_slug"),
    // provider's message id — set once the provider acknowledges (accepted); the DLR correlation key.
    providerRef: text("provider_ref"),
    errorCode: text("error_code"),
    /** Immutable explanation of the accepted charge; never recomputed after a rate edit. */
    pricingSnapshot: jsonb("pricing_snapshot").$type<PricingSnapshot>(),
    ...timestamps,
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    index("idx_messages_tenant_created").on(t.tenantId, t.createdAt),
    check(
      "messages_backing_chk",
      sql`${t.backing} in ('wallet', 'tokens', 'sandbox_allowance')`,
    ),
    // provider_ref must be unique per provider so a DLR maps to exactly one message (dedup + B2).
    // Partial (provider_ref set only once acknowledged) — also serves the reconcile lookup.
    uniqueIndex("uniq_messages_provider_ref")
      .on(t.providerSlug, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    uniqueIndex("uniq_messages_id_tenant").on(t.id, t.tenantId),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "messages_application_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "messages_environment_application_tenant_fk",
    }).onDelete("restrict"),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/** Durable dispatch intent. It is inserted in the same transaction as the message and wallet
 * reservation; only encrypted-vault references live on the message, never raw recipient/body. */
export const messageDispatches = pgTable(
  "message_dispatches",
  {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When a worker claimed this dispatch. Written on every claim and READ to decide whether that
    // claim has gone stale — a claim with no expiry turns a worker crash into an orphan whose wallet
    // reserve is never settled. WhatsApp learned this the expensive way (0147).
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("idx_message_dispatches_pending")
      .on(t.availableAt, t.messageId)
      .where(sql`completed_at IS NULL`),
    index("idx_message_dispatches_stale_lease")
      .on(t.leasedAt)
      .where(sql`completed_at IS NULL AND status = 'sending'`),
  ],
);

export type MessageDispatch = typeof messageDispatches.$inferSelect;

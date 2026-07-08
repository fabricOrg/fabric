import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_shared.js";

/**
 * MAKER-CHECKER — a two-person control for consequential tenant changes (wallet adjustments, plan
 * changes, refunds). A maker proposes; a DIFFERENT admin (the checker) approves or rejects. Both the
 * proposal and the decision are audited. Platform-level (no tenant/RLS — staff governance).
 *
 * Executing an approved proposal's effect (actually adjusting the wallet, changing the plan) is a
 * separate step deferred until those target features exist; today approval records intent + audits.
 */
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // wallet_adjustment | plan_change | refund
  tenantId: uuid("tenant_id"),
  tenantLabel: text("tenant_label").notNull(), // denormalized display name
  beforeValue: text("before_value").notNull(),
  afterValue: text("after_value").notNull(),
  reason: text("reason").notNull(), // the maker's justification
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  makerStaffId: uuid("maker_staff_id"),
  makerEmail: text("maker_email").notNull(),
  checkerStaffId: uuid("checker_staff_id"),
  checkerEmail: text("checker_email"),
  decidedReason: text("decided_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
});

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * AUDIT — an append-only record of every consequential staff/control-plane action. Platform-level
 * (no tenant_id, no RLS — same shape as staff_users / plugin_instances; read via the elevated
 * provisioning connection). Rows are NEVER updated or deleted; there's no updated_at. `metadata`
 * carries the before→after diff and any structured context; `reason` is the operator's justification
 * (required for the sensitive actions — kill-switch, impersonation, maker-checker decisions).
 */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The acting staff member. Nullable so system/automated actions can also be recorded.
  actorStaffId: uuid("actor_staff_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(), // dotted verb, e.g. "kill_switch.toggle", "staff.invite"
  targetType: text("target_type"), // e.g. "tenant", "staff_user", "kill_switch"
  targetId: text("target_id"),
  summary: text("summary").notNull(), // human-readable one-liner for the log
  reason: text("reason"),
  metadata: jsonb("metadata").notNull().default({}),
  // JavaScript Date and the public cursor preserve milliseconds. Matching the database precision
  // keeps (created_at, id) keyset pagination lossless when several events land in the same ms.
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

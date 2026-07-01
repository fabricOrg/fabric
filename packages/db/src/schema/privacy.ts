import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  bytea,
  type DekId,
  type SubjectId,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * PRIVACY domain — PII tokenization + crypto-shred erasure (pre-impl review B7; COMPLIANCE §5).
 *
 * THE PROBLEM: right-to-erasure ("delete my data") collides with our APPEND-ONLY ledger/audit,
 * which must never be edited. THE RESOLUTION (Bird's published model):
 *   - Raw PII (phone, message body, contact attributes) lives ONLY here, in `pii_vault`,
 *     encrypted with a per-subject Data Encryption Key (DEK).
 *   - Every other table (messages, contacts, otp, ledger refs) references a `subject_id`
 *     SURROGATE — never a raw phone number.
 *   - ERASURE = destroy that subject's DEK (`dek_keys`). The ciphertext instantly becomes
 *     permanently unreadable, while ledger/audit rows keep their `subject_id` and amounts intact.
 * This is "crypto-shredding": you don't delete the rows, you throw away the only key.
 *
 * All tables here are tenant-scoped (carry tenant_id → RLS applies, see sql/0001).
 */

export const piiKind = pgEnum("pii_kind", ["phone", "body", "attribute"]);
export const dekStatus = pgEnum("dek_status", ["active", "destroyed"]);

// A data subject = a person we hold PII about (typically an SMS recipient). The stable surrogate
// `subject_id` is what the rest of the platform references instead of a raw phone number.
export const dataSubjects = pgTable("data_subjects", {
  subjectId: uuid("subject_id").primaryKey().defaultRandom().$type<SubjectId>(),
  tenantId: tenantIdCol().references(() => accounts.id, {
    onDelete: "cascade",
  }),
  ...timestamps,
});

// One Data Encryption Key per subject, stored ONLY in wrapped form (encrypted by the KMS master
// key — "envelope encryption"). Destroying it (status=destroyed, wrapped_dek=NULL) is erasure.
export const dekKeys = pgTable("dek_keys", {
  dekId: uuid("dek_id").primaryKey().defaultRandom().$type<DekId>(),
  tenantId: tenantIdCol().references(() => accounts.id, {
    onDelete: "cascade",
  }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => dataSubjects.subjectId, { onDelete: "cascade" })
    .$type<SubjectId>(),
  // The DEK encrypted by KMS. NULL once crypto-shredded. We NEVER store an unwrapped DEK at rest.
  wrappedDek: bytea("wrapped_dek"),
  status: dekStatus("status").notNull().default("active"),
  destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  ...timestamps,
});

// The only place raw PII lives — as ciphertext encrypted with the subject's DEK. One row per piece.
export const piiVault = pgTable("pii_vault", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdCol().references(() => accounts.id, {
    onDelete: "cascade",
  }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => dataSubjects.subjectId, { onDelete: "cascade" })
    .$type<SubjectId>(),
  kind: piiKind("kind").notNull(),
  ciphertext: bytea("ciphertext").notNull(), // encrypted with the subject's DEK; unreadable after shred
  dekId: uuid("dek_id")
    .notNull()
    .references(() => dekKeys.dekId)
    .$type<DekId>(),
  ...timestamps,
});

// Immutable proof that an erasure was requested + completed — retained as compliance evidence
// (Bird keeps such proof ~5 years). This row SURVIVES erasure; only the PII becomes unreadable.
export const erasureLog = pgTable("erasure_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // F4: RESTRICT — erasure evidence is retained ~5yr and must survive an account removal; a cascade
  // here would destroy the very compliance proof this table exists to keep.
  tenantId: tenantIdCol().references(() => accounts.id, {
    onDelete: "restrict",
  }),
  subjectId: uuid("subject_id").notNull().$type<SubjectId>(), // not FK: subject row may be gone
  requestedBy: text("requested_by").notNull(), // staff/operator id (DSR — F7.7)
  basis: text("basis").notNull(), // legal basis / reason
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type DataSubject = typeof dataSubjects.$inferSelect;
export type DekKey = typeof dekKeys.$inferSelect;
export type PiiVaultEntry = typeof piiVault.$inferSelect;

import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
export const dataSubjects = pgTable(
  "data_subjects",
  {
    subjectId: uuid("subject_id")
      .primaryKey()
      .defaultRandom()
      .$type<SubjectId>(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    /**
     * Blind index — HMAC(phone, index key), NOT the phone. Resolving "have we seen this number
     * before?" must not require decrypting every subject's vault, and crypto-shredding must not
     * orphan the lookup. This survives erasure by design: it identifies the subject, and it is
     * one-way, so it reveals nothing without the number already in hand. Scoped per tenant so the
     * same number under two tenants is two subjects (RLS is the boundary).
     */
    phoneHash: text("phone_hash"),
    /**
     * Set when this subject was crypto-shredded. An erased subject is CLOSED, not deleted: the row
     * stays so history keeps its surrogate, but it stops being the tenant's subject for that number.
     *
     * This is what lets a tenant contact the number again afterwards — a later send mints a NEW
     * subject with a fresh DEK, instead of failing forever against a subject whose key is gone.
     * Erasure and suppression are different things: whether the tenant MAY message them is the
     * consent engine's call (opt-outs), not the vault's.
     */
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Partial: only ONE LIVE subject per (tenant, number). Erased subjects keep their phone_hash for
    // history and drop out of the lookup, so the number can be re-subjected after an erasure.
    uniqueIndex("uniq_data_subject_tenant_phone_live")
      .on(t.tenantId, t.phoneHash)
      .where(sql`erased_at IS NULL`),
  ],
);

// One Data Encryption Key per subject, stored ONLY in wrapped form (encrypted by the KMS master
// key — "envelope encryption"). Destroying it (status=destroyed, wrapped_dek=NULL) is erasure.
export const dekKeys = pgTable(
  "dek_keys",
  {
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
  },
  (t) => [
    // EXACTLY ONE DEK PER SUBJECT. Without this, the `ON CONFLICT DO NOTHING` on the insert has no
    // constraint to conflict against and is silently a no-op, so two concurrent first-sends to the
    // same new recipient mint two active DEKs and seal that person's PII under different keys.
    unique("uniq_dek_subject").on(t.subjectId),
    // The send path resolves the active DEK on EVERY message; unindexed this is a seq scan that
    // degrades with the tenant's contact list.
    index("idx_dek_keys_subject_status").on(t.subjectId, t.status),
  ],
);

// The only place raw PII lives — as ciphertext encrypted with the subject's DEK. One row per piece.
export const piiVault = pgTable(
  "pii_vault",
  {
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
  },
  (t) => [
    // The inbox resolves the newest value per (subject, kind) for a whole page at a time; unindexed
    // that is a seq scan of every tenant's PII on each load.
    index("idx_pii_vault_subject_kind").on(t.subjectId, t.kind, t.createdAt),
  ],
);

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

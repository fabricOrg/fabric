import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { type SubjectId, tenantIdCol, timestamps } from "./_shared.js";
import { dataSubjects, piiVault } from "./privacy.js";
import { messages } from "./sms.js";

/**
 * Tenant-visible projection of a canonical virtual message.
 *
 * PII lives in `pii_vault` under the recipient's per-subject DEK — NOT here. This table holds only
 * surrogates (`subject_id`, `body_pii_id`), so destroying that subject's DEK (erasure) renders the
 * recipient and body permanently unreadable while the message, its ledger entries, and its delivery
 * history stay intact. The original `*_ciphertext` columns encrypted under a single platform-wide
 * key, which erasure could not reach; they are nullable during the backfill and dropped once every
 * row is migrated (see scripts/ops/migrate-virtual-deliveries-to-vault.ts).
 */
export const virtualDeliveries = pgTable(
  "virtual_deliveries",
  {
    messageId: uuid("message_id").primaryKey(),
    tenantId: tenantIdCol(),
    subjectId: uuid("subject_id")
      .references(() => dataSubjects.subjectId, { onDelete: "restrict" })
      .$type<SubjectId>(),
    bodyPiiId: uuid("body_pii_id").references(() => piiVault.id, {
      onDelete: "set null",
    }),
    /** @deprecated platform-key ciphertext — erasure cannot reach it. Backfilled into the vault. */
    recipientCiphertext: text("recipient_ciphertext"),
    /** @deprecated platform-key ciphertext — erasure cannot reach it. Backfilled into the vault. */
    bodyCiphertext: text("body_ciphertext"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.messageId, t.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
      name: "virtual_deliveries_message_tenant_fk",
    }).onDelete("cascade"),
    index("idx_virtual_deliveries_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

export type VirtualDelivery = typeof virtualDeliveries.$inferSelect;

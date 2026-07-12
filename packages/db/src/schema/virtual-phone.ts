import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";
import { messages } from "./sms.js";

/** Encrypted tenant-visible projection of a canonical virtual message. */
export const virtualDeliveries = pgTable(
  "virtual_deliveries",
  {
    messageId: uuid("message_id").primaryKey(),
    tenantId: tenantIdCol(),
    recipientCiphertext: text("recipient_ciphertext").notNull(),
    bodyCiphertext: text("body_ciphertext").notNull(),
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

import {
  currency,
  type MessageDetail,
  type MessageStatus,
  type MessageSummary,
} from "@app/contracts";
import { type AppDb, findCustomerMessage, listCustomerMessages } from "@app/db";
import { notFound } from "../http/api-error.js";
import { encodeCursor, type KeysetCursor } from "../http/cursor.js";

/** Read-side message shaping for SmsService (split out for the file-length guard). */

export interface MessagePageResult {
  messages: MessageSummary[];
  next_cursor: string | null;
}

export async function listMessages(
  db: AppDb,
  tenantId: string,
  environmentId: string | null | undefined,
  page: { limit: number; before?: KeysetCursor },
): Promise<MessagePageResult> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    const rows = await listCustomerMessages(tx, environmentId, page);
    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible[visible.length - 1];
    return {
      messages: visible.map(toMessageSummary),
      next_cursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.cursorTs, id: last.id })
          : null,
    };
  });
}

export async function getMessage(
  db: AppDb,
  tenantId: string,
  id: string,
  environmentId?: string | null,
): Promise<MessageDetail> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    const row = await findCustomerMessage(tx, id, environmentId);
    if (!row) {
      throw notFound("message_not_found", "No message exists with that id.");
    }
    const summary = toMessageSummary(row);
    return {
      ...summary,
      sender_id: row.senderId,
      redacted: true,
      timeline: [
        {
          status: summary.status,
          at: row.updatedAt.toISOString(),
        },
      ],
      ...(row.errorCode ? { failure_reason: row.errorCode } : {}),
    };
  });
}

function toMessageSummary(row: {
  id: string;
  status: MessageStatus;
  encoding: "gsm7" | "ucs2";
  segments: number;
  costMinor: bigint;
  currency: string;
  providerSlug: string | null;
  deliveryMode: string;
  subjectId: string | null;
  createdAt: Date;
}): MessageSummary {
  return {
    id: row.id,
    to: row.subjectId ? "Protected recipient" : "Recipient hidden",
    status: row.status,
    encoding: row.encoding,
    segments: row.segments,
    cost: {
      currency: currency.parse(row.currency),
      minor: row.costMinor.toString(),
    },
    provider: row.providerSlug ?? "pending",
    delivery_mode: row.deliveryMode === "virtual" ? "virtual" : "live",
    created_at: row.createdAt.toISOString(),
  };
}

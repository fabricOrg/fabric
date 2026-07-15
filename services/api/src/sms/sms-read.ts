import {
  currency,
  type MessageDetail,
  type MessageStatus,
  type MessageSummary,
} from "@app/contracts";
import { type AppDb, findCustomerMessage, listCustomerMessages } from "@app/db";
import { notFound } from "../http/api-error.js";

/** Read-side message shaping for SmsService (split out for the file-length guard). */

export async function listMessages(
  db: AppDb,
  tenantId: string,
  environmentId?: string | null,
): Promise<MessageSummary[]> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    const rows = await listCustomerMessages(tx, environmentId);
    return rows.map(toMessageSummary);
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
      senderId: row.senderId,
      redacted: true,
      timeline: [
        {
          status: summary.status,
          at: row.updatedAt.toISOString(),
        },
      ],
      ...(row.errorCode ? { failureReason: row.errorCode } : {}),
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
    deliveryMode: row.deliveryMode === "virtual" ? "virtual" : "live",
    createdAt: row.createdAt.toISOString(),
  };
}

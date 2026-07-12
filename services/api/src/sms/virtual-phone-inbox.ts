import type { VirtualPhoneInbox } from "@app/contracts";
import { type AppDb, clampLimit, decodeCursor, encodeCursor } from "@app/db";
import { invalidRequest } from "../http/api-error.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;
const ERASED = "[erased]";
const PENDING = "[pending migration]";

export async function listVirtualInbox(input: {
  db: AppDb;
  vault: PiiVaultService;
  tenantId: string;
  virtualNumber: string;
  retentionDays: number;
  cursor?: string;
  limit?: number;
  recipient?: string;
}): Promise<VirtualPhoneInbox> {
  const limit = clampLimit(input.limit, 50, 100);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cursor) {
    throw invalidRequest("invalid_cursor", "The inbox cursor is invalid.");
  }
  const subjectId = input.recipient
    ? await input.vault.findSubjectForPhone(input.tenantId, input.recipient)
    : null;
  if (input.recipient && !subjectId) return emptyInbox(input);

  const rows = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
    SELECT * FROM (
      SELECT m.id, m.sender_id, m.status::text, m.segments, m.created_at,
             m.created_at::text AS sort_cursor, v.subject_id, v.body_pii_id,
             v.read_at, (v.recipient_ciphertext IS NOT NULL) AS legacy,
             'outbound'::text AS direction
      FROM virtual_deliveries v JOIN messages m ON m.id = v.message_id
      UNION ALL
      SELECT i.id, NULL, 'delivered', 1, i.created_at, i.created_at::text,
             i.subject_id, i.body_pii_id, i.created_at, false, 'inbound'
      FROM inbound_messages i
    ) inbox
    WHERE (${subjectId}::uuid IS NULL OR inbox.subject_id = ${subjectId}::uuid)
      AND ((${cursor?.primary ?? null}::timestamptz IS NULL)
       OR inbox.created_at < ${cursor?.primary ?? null}::timestamptz
       OR (inbox.created_at = ${cursor?.primary ?? null}::timestamptz
           AND inbox.id < ${cursor?.id ?? null}::uuid))
    ORDER BY inbox.created_at DESC, inbox.id DESC
    LIMIT ${limit + 1}`,
  )) as Row[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const [bodies, phones] = await Promise.all([
    input.vault.readMany(
      input.tenantId,
      page.flatMap((row) => (row.body_pii_id ? [String(row.body_pii_id)] : [])),
    ),
    input.vault.readPhones(input.tenantId, [
      ...new Set(
        page.flatMap((row) => (row.subject_id ? [String(row.subject_id)] : [])),
      ),
    ]),
  ]);
  const messages: VirtualPhoneInbox["messages"] = page.map((row) => {
    const subject = row.subject_id ? String(row.subject_id) : null;
    const bodyId = row.body_pii_id ? String(row.body_pii_id) : null;
    const phone = subject ? (phones.get(subject) ?? null) : null;
    const body = bodyId ? (bodies.get(bodyId) ?? null) : null;
    const unreadable = phone === null || body === null;
    const pending = unreadable && !subject && row.legacy === true;
    const placeholder = pending ? PENDING : ERASED;
    const inbound = row.direction === "inbound";
    return {
      id: String(row.id),
      to: inbound ? input.virtualNumber : (phone ?? placeholder),
      from: inbound ? (phone ?? placeholder) : String(row.sender_id),
      body: body ?? placeholder,
      erased: unreadable && !pending,
      status: row.status as VirtualPhoneInbox["messages"][number]["status"],
      segments: Number(row.segments),
      created_at: new Date(String(row.created_at)).toISOString(),
      read_at: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
      direction: inbound ? "inbound" : "outbound",
    };
  });
  const last = page.at(-1);
  return {
    virtual_number: input.virtualNumber,
    messages,
    next_cursor:
      hasMore && last
        ? encodeCursor(String(last.sort_cursor), String(last.id))
        : null,
    retention_days: input.retentionDays,
  };
}

function emptyInbox(input: {
  virtualNumber: string;
  retentionDays: number;
}): VirtualPhoneInbox {
  return {
    virtual_number: input.virtualNumber,
    messages: [],
    next_cursor: null,
    retention_days: input.retentionDays,
  };
}

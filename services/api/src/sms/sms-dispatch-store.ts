import type { DeliveryMode, MessageStatus } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PreparedSend, SendInput } from "@app/sms-engine";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;

export type StoredDispatch =
  | { kind: "skip"; status: MessageStatus }
  | {
      kind: "ready";
      input: SendInput;
      prepared: PreparedSend;
      deliveryMode: DeliveryMode;
    }
  | {
      kind: "unreadable";
      input: SendInput;
      prepared: PreparedSend;
      deliveryMode: DeliveryMode;
    };

export async function loadStoredDispatch(input: {
  db: AppDb;
  vault: PiiVaultService;
  tenantId: string;
  messageId: string;
}): Promise<StoredDispatch> {
  const rows = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
      SELECT m.id, m.application_id, m.environment_id, m.subject_id, m.body_pii_id,
             m.sender_id, m.status::text, m.encoding::text, m.segments, m.currency,
             m.delivery_mode, d.completed_at
      FROM messages m
      JOIN message_dispatches d ON d.message_id = m.id
      WHERE m.id = ${input.messageId}
      LIMIT 1`,
  )) as Row[];
  const row = rows[0];
  if (!row) return { kind: "skip", status: "failed" };
  const status = String(row.status) as MessageStatus;
  if (row.completed_at || isTerminal(status)) return { kind: "skip", status };

  const subjectId = row.subject_id ? String(row.subject_id) : null;
  const bodyPiiId = row.body_pii_id ? String(row.body_pii_id) : null;
  const [to, body] = await Promise.all([
    subjectId
      ? input.vault.readLatest(input.tenantId, subjectId, "phone")
      : Promise.resolve(null),
    bodyPiiId
      ? input.vault.read(input.tenantId, bodyPiiId)
      : Promise.resolve(null),
  ]);
  const deliveryMode: DeliveryMode =
    row.delivery_mode === "virtual" ? "virtual" : "live";
  const storedInput: SendInput = {
    tenantId: input.tenantId,
    applicationId: row.application_id ? String(row.application_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    to: to ?? "[unreadable]",
    senderId: String(row.sender_id),
    body: body ?? "[unreadable]",
    currency: String(row.currency),
    ...(subjectId ? { subjectId } : {}),
    ...(bodyPiiId ? { bodyPiiId } : {}),
    deliveryMode,
  };
  const prepared: PreparedSend = {
    messageId: String(row.id),
    encoding: row.encoding === "ucs2" ? "ucs2" : "gsm7",
    segments: Number(row.segments),
  };
  if (to === null || body === null) {
    return { kind: "unreadable", input: storedInput, prepared, deliveryMode };
  }
  return { kind: "ready", input: storedInput, prepared, deliveryMode };
}

export async function completeStoredDispatch(
  db: AppDb,
  tenantId: string,
  messageId: string,
): Promise<void> {
  await db.withTenant(
    tenantId,
    (tx) => tx`
      UPDATE message_dispatches
      SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE message_id = ${messageId} AND completed_at IS NULL`,
  );
}

export async function pendingDispatches(
  db: AppDb,
  tenantId: string,
  limit = 100,
): Promise<Array<{ messageId: string; deliveryMode: DeliveryMode }>> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT d.message_id, m.delivery_mode
      FROM message_dispatches d JOIN messages m ON m.id = d.message_id
      WHERE d.completed_at IS NULL AND d.available_at <= now()
      ORDER BY d.available_at, d.message_id
      LIMIT ${limit}`,
  )) as Row[];
  return rows.map((row) => ({
    messageId: String(row.message_id),
    deliveryMode: row.delivery_mode === "virtual" ? "virtual" : "live",
  }));
}

function isTerminal(status: MessageStatus): boolean {
  return ["delivered", "undelivered", "failed", "expired"].includes(status);
}

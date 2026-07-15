import { createHash } from "node:crypto";
import type { VirtualPhoneReplyResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import type { AuditService } from "../audit/audit.service.js";
import { hashMsisdn, maskMsisdn } from "../consent/msisdn.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;

export function virtualNumberFor(tenantId: string): string {
  const digest = createHash("sha256").update(tenantId).digest("hex");
  const subscriber = (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000_000n)
    .toString()
    .padStart(9, "0");
  // +999 is reserved for an international service trial and cannot reach a real subscriber.
  return `+999${subscriber}`;
}

export function virtualRetentionDays(config: ConfigService): number {
  const value = Number(
    config.get<string>("VIRTUAL_PHONE_RETENTION_DAYS") ?? "30",
  );
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30;
}

export async function recordVirtualReply(input: {
  db: AppDb;
  vault: PiiVaultService;
  tenantId: string;
  to: string;
  body: string;
}): Promise<VirtualPhoneReplyResponse> {
  const subjectId = await input.vault.subjectForPhone(input.tenantId, input.to);
  const bodyPiiId = await input.vault.put(
    input.tenantId,
    subjectId,
    "body",
    input.body,
  );
  const normalized = input.body.trim().toUpperCase();
  const keyword = ["STOP", "START", "HELP"].includes(normalized)
    ? (normalized as "STOP" | "START" | "HELP")
    : null;
  const result = await input.db.withTenant(input.tenantId, async (tx) => {
    const contexts = (await tx`
      SELECT a.id AS application_id, e.id AS environment_id
      FROM applications a
      JOIN environments e ON e.application_id = a.id AND e.tenant_id = a.tenant_id
      WHERE a.tenant_id = current_setting('app.tenant_id')::uuid
        AND a.slug = 'default' AND e.type = 'sandbox'
      LIMIT 1`) as Row[];
    const context = contexts[0];
    if (!context) {
      throw new Error("Default sandbox environment is not provisioned.");
    }
    const inserted = (await tx`
      INSERT INTO inbound_messages (
        tenant_id, subject_id, body_pii_id, virtual_number, keyword
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${subjectId}, ${bodyPiiId},
        ${virtualNumberFor(input.tenantId)}, ${keyword}
      ) RETURNING id`) as Row[];
    const id = String(inserted[0]?.id ?? "");
    if (!id) throw new Error("Inbound message insert returned no row.");
    let consentChanged = false;
    if (keyword === "STOP") {
      await tx`
        INSERT INTO opt_outs (tenant_id, msisdn_hash, msisdn_masked, scope, source)
        VALUES (
          current_setting('app.tenant_id')::uuid, ${hashMsisdn(input.to)},
          ${maskMsisdn(input.to)}, 'promotional', 'stop'
        ) ON CONFLICT (tenant_id, msisdn_hash) DO UPDATE SET
          scope = 'promotional', source = 'stop', updated_at = now()`;
      consentChanged = true;
    }
    if (keyword === "START") {
      const removed = (await tx`
        DELETE FROM opt_outs
        WHERE tenant_id = current_setting('app.tenant_id')::uuid
          AND msisdn_hash = ${hashMsisdn(input.to)} AND source = 'stop'
        RETURNING id`) as Row[];
      consentChanged = removed.length > 0;
    }
    await tx`
      INSERT INTO outbox_events (
        tenant_id, application_id, environment_id, event_type, payload
      )
      VALUES (
        current_setting('app.tenant_id')::uuid, ${String(context.application_id)},
        ${String(context.environment_id)}, 'message.received',
        ${JSON.stringify({ id, subject_id: subjectId, channel: "sms" })}::jsonb
      )`;
    if (consentChanged) {
      await tx`
        INSERT INTO outbox_events (tenant_id, event_type, payload)
        VALUES (
          current_setting('app.tenant_id')::uuid,
          ${keyword === "STOP" ? "contact.opted_out" : "contact.opted_in"},
          ${JSON.stringify({ subject_id: subjectId, source: keyword?.toLowerCase() })}::jsonb
        )`;
    }
    return { id, consentChanged };
  });
  return { id: result.id, keyword, consent_changed: result.consentChanged };
}

export async function clearVirtualMessages(input: {
  db: AppDb;
  tenantId: string;
  before?: string;
}): Promise<number> {
  return input.db.withTenant(input.tenantId, async (tx) => {
    const inbound = (await tx`
      DELETE FROM inbound_messages
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
        AND (${input.before ?? null}::timestamptz IS NULL OR created_at < ${input.before ?? null}::timestamptz)
      RETURNING body_pii_id`) as Row[];
    const outbound = (await tx`
      DELETE FROM virtual_deliveries
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
        AND (${input.before ?? null}::timestamptz IS NULL OR created_at < ${input.before ?? null}::timestamptz)
      RETURNING body_pii_id`) as Row[];
    const piiIds = [...inbound, ...outbound].flatMap((row) =>
      row.body_pii_id ? [String(row.body_pii_id)] : [],
    );
    if (piiIds.length > 0) {
      await tx`DELETE FROM pii_vault WHERE id = ANY(${piiIds}::uuid[])`;
    }
    return inbound.length + outbound.length;
  });
}

export async function auditVirtualClear(input: {
  audit: AuditService;
  tenantId: string;
  actorEmail?: string;
  cleared: number;
}): Promise<void> {
  await input.audit.record({
    actorEmail: input.actorEmail ?? null,
    action: "tenant.virtual_phone.inbox_cleared",
    targetType: "tenant",
    targetId: input.tenantId,
    summary: `Virtual phone inbox cleared (${input.cleared} message${input.cleared === 1 ? "" : "s"}).`,
    metadata: { tenant_id: input.tenantId, cleared: input.cleared },
  });
}

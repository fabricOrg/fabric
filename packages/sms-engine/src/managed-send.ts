import type { TenantTx } from "@app/db";

type Row = Record<string, unknown>;

export interface ManagedSendContext {
  deliveryId: string;
  definitionId: string;
  versionId: string;
  key: string;
  locale: string;
  reference?: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
  idempotencyKey: string;
  requestFingerprint: string;
  maxCostMinor?: string;
  expiresAt: Date;
}

export class ManagedIdempotencyConflictError extends Error {}
export class ManagedCostLimitError extends Error {}

export async function findManagedReplay(
  tx: TenantTx,
  input: {
    applicationId?: string | null;
    environmentId?: string | null;
    managed: ManagedSendContext;
  },
): Promise<string | null> {
  const existing = (await tx`
    SELECT id, request_fingerprint
    FROM message_deliveries
    WHERE application_id = ${input.applicationId ?? null}
      AND environment_id = ${input.environmentId ?? null}
      AND idempotency_key = ${input.managed.idempotencyKey}
    FOR UPDATE`) as Row[];
  if (!existing[0]) return null;
  if (existing[0].request_fingerprint !== input.managed.requestFingerprint) {
    throw new ManagedIdempotencyConflictError();
  }
  return String(existing[0].id);
}

export async function persistManagedAcceptance(
  tx: TenantTx,
  input: {
    applicationId?: string | null;
    environmentId?: string | null;
    currency: string;
    managed: ManagedSendContext;
    // The channel and its message reference. `messageId` is the SMS `messages.id`; `emailMessageId` is
    // the `email_messages.id`; `whatsappMessageId` is the `whatsapp_messages.id`. Exactly the
    // channel-matching one is set (enforced by the attempt CHECK).
    channel: "sms" | "email" | "whatsapp";
    messageId?: string;
    emailMessageId?: string;
    whatsappMessageId?: string;
    costMinor: string;
  },
): Promise<{ messageId: string; replayed: boolean }> {
  // Keyed lookup rather than `channel === "email" ? … : messageId`: under that ternary a new channel
  // would silently resolve to the SMS reference and write an attempt row claiming the wrong message.
  const references: Record<typeof input.channel, string | undefined> = {
    sms: input.messageId,
    email: input.emailMessageId,
    whatsapp: input.whatsappMessageId,
  };
  const channelMessageId = references[input.channel];
  if (!channelMessageId) {
    throw new Error(
      `persistManagedAcceptance: missing ${input.channel} message id`,
    );
  }
  const inserted = (await tx`
    INSERT INTO message_deliveries (
      id, tenant_id, application_id, environment_id, definition_id, version_id,
      key, locale, channel, status, reference, metadata, idempotency_key,
      request_fingerprint, currency, max_cost_minor, total_cost_minor, expires_at
    ) VALUES (
      ${input.managed.deliveryId}, current_setting('app.tenant_id')::uuid,
      ${input.applicationId ?? null}, ${input.environmentId ?? null},
      ${input.managed.definitionId}, ${input.managed.versionId}, ${input.managed.key},
      ${input.managed.locale}, ${input.channel}, 'accepted', ${input.managed.reference ?? null},
      ${JSON.stringify(input.managed.metadata)}::jsonb, ${input.managed.idempotencyKey},
      ${input.managed.requestFingerprint}, ${input.currency},
      ${input.managed.maxCostMinor ?? null}::bigint, ${input.costMinor}::bigint,
      ${input.managed.expiresAt.toISOString()}::timestamptz
    ) ON CONFLICT (tenant_id, application_id, environment_id, idempotency_key)
      DO NOTHING
    RETURNING id`) as Row[];
  if (!inserted[0]) {
    const replay = await findManagedReplay(tx, input);
    if (!replay) throw new ManagedIdempotencyConflictError();
    return { messageId: replay, replayed: true };
  }
  await tx`
    INSERT INTO message_delivery_attempts (
      tenant_id, application_id, environment_id, delivery_id, ordinal, channel,
      message_id, email_message_id, whatsapp_message_id, status, cost_minor, currency
    ) VALUES (
      current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
      ${input.environmentId ?? null}, ${input.managed.deliveryId}, 1, ${input.channel},
      ${input.channel === "sms" ? channelMessageId : null},
      ${input.channel === "email" ? channelMessageId : null},
      ${input.channel === "whatsapp" ? channelMessageId : null},
      'accepted', ${input.costMinor}::bigint, ${input.currency}
    )`;
  await tx`
    INSERT INTO outbox_events (
      tenant_id, application_id, environment_id, event_type, payload
    ) VALUES (
      current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
      ${input.environmentId ?? null}, 'message.accepted',
      ${JSON.stringify({
        delivery_id: input.managed.deliveryId,
        message_id: channelMessageId,
        key: input.managed.key,
        version_id: input.managed.versionId,
        status: "accepted",
        resource_version: 1,
      })}::jsonb
    )`;
  return { messageId: channelMessageId, replayed: false };
}

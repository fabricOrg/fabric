import { encodeAndSegment, rateSegments } from "@app/domain";
import { STATUS_RANK } from "@app/integrations";
import { reserve } from "@app/wallet";
import type { EngineDeps, PreparedSend, SendInput } from "./engine-types.js";
import {
  findManagedReplay,
  ManagedCostLimitError,
  persistManagedAcceptance,
} from "./managed-send.js";

type Row = Record<string, unknown>;

/** Persist the message, reserve funds, and create its recoverable dispatch intent atomically. */
export async function prepareSend(
  deps: EngineDeps,
  input: SendInput,
): Promise<PreparedSend> {
  const seg = encodeAndSegment(input.body);
  const cost = rateSegments(seg.segments, input.currency, deps.rates);
  if (
    input.managed?.maxCostMinor !== undefined &&
    cost > BigInt(input.managed.maxCostMinor)
  ) {
    throw new ManagedCostLimitError();
  }
  const prepared = await deps.db.withTenant(input.tenantId, async (tx) => {
    if (input.managed) {
      const replay = await findManagedReplay(tx, {
        managed: input.managed,
        ...(input.applicationId !== undefined
          ? { applicationId: input.applicationId }
          : {}),
        ...(input.environmentId !== undefined
          ? { environmentId: input.environmentId }
          : {}),
      });
      if (replay) return { messageId: replay, replayed: true };
    }
    const rows = (await tx`
      INSERT INTO messages (
        id, tenant_id, application_id, environment_id, subject_id, body_pii_id, sender_id,
        status, status_rank, encoding, segments, cost_minor, currency, delivery_mode, provider_slug
      ) VALUES (
        COALESCE(${input.messageId ?? null}::uuid, gen_random_uuid()),
        current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
        ${input.environmentId ?? null}, ${input.subjectId ?? null}, ${input.bodyPiiId ?? null},
        ${input.senderId}, 'sending', ${STATUS_RANK.sending}, ${seg.encoding}, ${seg.segments},
        ${cost.toString()}::bigint, ${input.currency}, ${input.deliveryMode ?? "live"},
        ${deps.provider.slug}
      ) ON CONFLICT (id) DO NOTHING
      RETURNING id`) as Row[];
    const createdId = rows[0]?.id;
    const existing =
      !createdId && input.messageId
        ? (
            (await tx`
            SELECT id FROM messages WHERE id = ${input.messageId} LIMIT 1`) as Row[]
          )[0]?.id
        : null;
    const resolvedId = createdId ?? existing;
    if (!resolvedId) throw new Error("Could not persist the prepared message.");
    const messageId = String(resolvedId);
    await reserve(tx, {
      currency: input.currency,
      amountMinor: cost,
      idempotencyKey: `reserve:${messageId}`,
      referenceId: messageId,
    });
    await tx`
      INSERT INTO message_dispatches (message_id, tenant_id)
      VALUES (${messageId}, current_setting('app.tenant_id')::uuid)
      ON CONFLICT (message_id) DO NOTHING`;
    if (input.managed) {
      return persistManagedAcceptance(tx, {
        managed: input.managed,
        currency: input.currency,
        channel: "sms",
        messageId,
        costMinor: cost.toString(),
        ...(input.applicationId !== undefined
          ? { applicationId: input.applicationId }
          : {}),
        ...(input.environmentId !== undefined
          ? { environmentId: input.environmentId }
          : {}),
      });
    }
    return { messageId, replayed: false };
  });
  return {
    messageId: prepared.messageId,
    encoding: seg.encoding,
    segments: seg.segments,
    ...(prepared.replayed ? { replayed: true } : {}),
  };
}

import type { TenantTx } from "@app/db";
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

type Backing = "wallet" | "tokens" | "sandbox_allowance";

/**
 * Try tokens for a NEWLY created message; fall back to the wallet. A held claim flips the row to
 * `backing = 'tokens'` in the same transaction, so the resolution path settles tokens instead of
 * money. Tokens unwired (no deps.tokens) keeps every send wallet-backed, exactly as before.
 */
async function chooseBacking(
  deps: EngineDeps,
  tx: TenantTx,
  p: {
    messageId: string;
    currency: string;
    segments: number;
    deliveryMode: "virtual" | "live";
    applicationId?: string | null;
    environmentId?: string | null;
  },
): Promise<Backing> {
  if (p.deliveryMode === "virtual") {
    if (!deps.sandboxAllowance) {
      // Fail closed: a virtual send without its allowance backend must never fall into money.
      throw new Error("Sandbox allowance backend is unavailable.");
    }
    await deps.sandboxAllowance.consume(tx, {
      channel: "sms",
      units: BigInt(p.segments),
      referenceId: p.messageId,
      ...(p.applicationId !== undefined
        ? { applicationId: p.applicationId }
        : {}),
      ...(p.environmentId !== undefined
        ? { environmentId: p.environmentId }
        : {}),
    });
    await tx`
      UPDATE messages SET backing = 'sandbox_allowance'
      WHERE id = ${p.messageId}`;
    return "sandbox_allowance";
  }
  if (!deps.tokens) return "wallet";
  // SMS is priced PER SEGMENT (ADR-0010 §5), so a 3-segment message claims 3 tokens, not 1.
  const outcome = await deps.tokens.hold(tx, {
    channel: "sms",
    currency: p.currency,
    quantity: BigInt(p.segments),
    referenceId: p.messageId,
  });
  if (!outcome.held) return "wallet";
  await tx`UPDATE messages SET backing = 'tokens' WHERE id = ${p.messageId}`;
  return "tokens";
}

/** The backing an already-persisted message was accepted under (retry path). */
async function readBacking(tx: TenantTx, messageId: string): Promise<Backing> {
  const rows = (await tx`
    SELECT backing FROM messages WHERE id = ${messageId} LIMIT 1`) as Row[];
  const backing = String(rows[0]?.backing ?? "wallet");
  if (backing === "tokens" || backing === "sandbox_allowance") return backing;
  return "wallet";
}

/** Persist the message, claim its backing, and create its recoverable dispatch intent atomically. */
export async function prepareSend(
  deps: EngineDeps,
  input: SendInput,
): Promise<PreparedSend> {
  const seg = encodeAndSegment(input.body);
  if (input.pricing && input.pricing.currency !== input.currency) {
    throw new Error("The pricing snapshot currency does not match the send.");
  }
  if (
    input.pricing &&
    input.pricing.snapshot.units !== BigInt(seg.segments).toString()
  ) {
    throw new Error("The pricing snapshot unit count does not match the send.");
  }
  const cost =
    input.pricing?.costMinor ??
    rateSegments(seg.segments, input.currency, deps.rates);
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
        status, status_rank, encoding, segments, cost_minor, currency, delivery_mode, provider_slug,
        pricing_snapshot
      ) VALUES (
        COALESCE(${input.messageId ?? null}::uuid, gen_random_uuid()),
        current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
        ${input.environmentId ?? null}, ${input.subjectId ?? null}, ${input.bodyPiiId ?? null},
        ${input.senderId}, 'sending', ${STATUS_RANK.sending}, ${seg.encoding}, ${seg.segments},
        ${cost.toString()}::bigint, ${input.currency}, ${input.deliveryMode ?? "live"},
        ${deps.provider.slug}, ${input.pricing ? JSON.stringify(input.pricing.snapshot) : null}::jsonb
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
    // ADR-0010 §8 resolution order: price book (already applied via deps.rates) → TOKENS first →
    // wallet money → reject. The wallet reserve below still fails closed; only the token attempt is
    // allowed to come up empty and fall through.
    //
    // The backing is decided ONCE, when the row is first created. On a retry of an existing message
    // we read what it already is: re-deciding could hand a message that already reserved money a
    // token hold as well (or vice versa) and charge for the same send twice.
    const backing = createdId
      ? await chooseBacking(deps, tx, {
          messageId,
          currency: input.currency,
          segments: seg.segments,
          deliveryMode: input.deliveryMode ?? "live",
          ...(input.applicationId !== undefined
            ? { applicationId: input.applicationId }
            : {}),
          ...(input.environmentId !== undefined
            ? { environmentId: input.environmentId }
            : {}),
        })
      : await readBacking(tx, messageId);
    if (backing === "wallet") {
      await reserve(tx, {
        currency: input.currency,
        amountMinor: cost,
        idempotencyKey: `reserve:${messageId}`,
        referenceId: messageId,
      });
    }
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

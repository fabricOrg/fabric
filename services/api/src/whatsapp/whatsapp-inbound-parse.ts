import { z } from "zod";

/**
 * Pure extraction of INBOUND messages from a Meta webhook payload (ADR-0015). No I/O, so the shape
 * questions can be settled in unit tests rather than against a live WABA.
 *
 * Deliberately lenient about message TYPE. Meta sends text, image, audio, document, sticker,
 * location, reaction, interactive replies and more, and it adds new ones. A type we do not model is
 * still a real message from a real customer inside a real conversation — refusing it would drop the
 * message AND fail to extend the service window, which is worse than storing something we cannot yet
 * render. So the type is recorded as-is and the raw message object is kept intact.
 */

const inboundMessage = z.object({
  id: z.string().trim().min(1),
  from: z.string().trim().min(1),
  // Meta sends unix SECONDS as a string. Absent on nothing we have seen, but treated as optional so a
  // missing timestamp falls back to arrival time rather than dropping the message.
  timestamp: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
});

const inboundEnvelope = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string().trim().min(1).optional(),
              value: z.object({
                metadata: z
                  .object({
                    phone_number_id: z.string().trim().min(1).optional(),
                  })
                  .optional(),
                messages: z.array(z.unknown()).optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export interface ParsedInboundMessage {
  /** Meta's `wamid` — the idempotency key for ingestion. */
  readonly providerRef: string;
  /** The consumer's E.164 number, as Meta reports it (no leading `+`). */
  readonly from: string;
  readonly type: string;
  /** OUR WABA number the consumer wrote to. */
  readonly phoneNumberId: string;
  readonly receivedAt: Date;
  /** The message object verbatim — the content, stored encrypted, never a column. */
  readonly raw: unknown;
}

/**
 * Every inbound message in the payload. A payload carrying only statuses or template events yields an
 * empty array; that is not an error, since Meta multiplexes all of them onto one endpoint.
 */
export function parseInboundMessages(
  payload: unknown,
  now: Date,
): ParsedInboundMessage[] {
  const parsed = inboundEnvelope.safeParse(payload);
  if (!parsed.success) return [];
  const out: ParsedInboundMessage[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const candidate of change.value.messages ?? []) {
        const message = inboundMessage.safeParse(candidate);
        if (!message.success) continue;
        out.push({
          providerRef: message.data.id,
          from: message.data.from,
          type: message.data.type ?? "unknown",
          phoneNumberId,
          receivedAt: metaTimestamp(message.data.timestamp, now),
          raw: candidate,
        });
      }
    }
  }
  return out;
}

/** Meta's unix SECONDS as a string. A value we cannot read becomes arrival time, never epoch zero. */
function metaTimestamp(value: string | undefined, now: Date): Date {
  if (!value) return now;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return now;
  return new Date(seconds * 1000);
}

/** Meta reports `from` without a leading `+`; every Fabric surface stores E.164 with one. */
export function toE164(from: string): string {
  return from.startsWith("+") ? from : `+${from}`;
}

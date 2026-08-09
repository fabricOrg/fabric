// Pure planning helpers for the managed send path: recipient/channel validation, the accepted-preview
// projection per channel, the request fingerprint, and the deterministic delivery id. No I/O — split
// out of managed-messages.service.ts to keep that file under the length guard.
import { createHash } from "node:crypto";
import type { MessageChannel, SendManagedMessageRequest } from "@app/contracts";
import { emailAddress } from "@app/contracts";
import { invalidRequest } from "../http/api-error.js";
import type { PreviewOutput } from "./message-preview.service.js";

const e164 = /^\+[1-9]\d{7,14}$/;

export type AcceptedPreview =
  | {
      channel: "email";
      costMinor: string;
      subject: string;
      text?: string;
      html?: string;
    }
  | { channel: "sms"; costMinor: string; body: string };

/**
 * The definition's channel is authoritative; the request's `to` must match it. Rejects pre-acceptance
 * with a stable code and never echoes the recipient value.
 */
export function assertRecipientMatchesChannel(
  channel: MessageChannel,
  recipient: string,
): void {
  // WhatsApp is phone-addressed like SMS, so it shares the E.164 rule. Written as an explicit arm
  // rather than folded into the `else` because the two channels agreeing today is a coincidence of
  // addressing, not a rule — a future channel must not inherit E.164 by falling through.
  const valid =
    channel === "email"
      ? emailAddress.safeParse(recipient).success
      : e164.test(recipient);
  if (!valid) {
    throw invalidRequest(
      "recipient_channel_mismatch",
      "The recipient does not match the message channel.",
      "to",
    );
  }
}

/**
 * Project the eligible preview to the per-channel content + cost the send reserves against. Branch on
 * channel first so each arm reads its own (correctly narrowed) preview field — a ternary-assigned union
 * would not narrow.
 */
export function acceptedPreview(
  preview: PreviewOutput,
  blocker: PreviewOutput["blockers"][number] | undefined,
): AcceptedPreview {
  const ineligible = () =>
    invalidRequest(
      blocker?.code ?? "message_not_eligible",
      "The managed message is not eligible to send.",
      blocker?.path || undefined,
    );
  if (preview.channel === "email") {
    const email = preview.email_preview;
    if (blocker || !email || !preview.eligible) throw ineligible();
    return {
      channel: "email",
      costMinor: email.cost_minor,
      subject: email.subject,
      ...(email.text ? { text: email.text } : {}),
      ...(email.html ? { html: email.html } : {}),
    };
  }
  const sms = preview.preview;
  if (blocker || !sms || !preview.eligible) throw ineligible();
  return { channel: "sms", costMinor: sms.cost_minor, body: sms.body };
}

export function requestFingerprint(request: SendManagedMessageRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

export function deterministicDeliveryId(input: {
  tenantId: string;
  applicationId: string;
  environmentId: string;
  idempotencyKey: string;
}): string {
  const bytes = createHash("sha256")
    .update(
      `${input.tenantId}:${input.applicationId}:${input.environmentId}:${input.idempotencyKey}`,
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

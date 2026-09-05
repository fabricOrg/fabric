// F5.3 — canonical message-status model. WHY it lives in @app/contracts (not @app/integrations):
// `message.status` is a PUBLIC API value — SDK + dev-portal read it off `GET /v1/sms/:id` and webhook
// payloads, and must type it WITHOUT pulling server-side integration code. So the values are DEFINED
// here (browser-safe zod enum); @app/integrations' provider raw→canonical mapping and the L5 send
// pipeline both IMPORT from here. See docs/PI-1/E5-sms-engine-delivery/F5.3-message-status-model.md.

import { z } from "zod";

// Canonical lifecycle (F5.3): queued → sending → accepted → sent → delivered | undelivered | failed,
// plus `expired`. `accepted` = provider acknowledged receipt (sync send() returned a ref) — the usual
// billing commit point; `sent` = provider reports it onward to the carrier/MNO (distinct in time, B1).
export const messageStatus = z.enum([
  "queued", // accepted by us, not yet handed to a provider
  "sending", // handed to the provider adapter, awaiting its sync ack
  "accepted", // provider acknowledged receipt (ProviderResult ref) — typical commit point
  "sent", // provider reports it onward to the carrier/MNO
  "delivered", // TERMINAL — carrier confirmed delivery
  "undelivered", // TERMINAL — carrier could not deliver (handset off, etc.)
  "failed", // TERMINAL — send failed (rejected, provider/platform error)
  "expired", // TERMINAL — no final DLR within TTL; resolved by the reservation sweeper
]);
export type MessageStatus = z.infer<typeof messageStatus>;

// Terminal set (F5.3): once a message reaches one of these, transitions are frozen — a later
// out-of-order lower status must NEVER overwrite it (monotonicity; see F5.4 reconciliation).
export const TERMINAL_MESSAGE_STATUSES = [
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;
export type TerminalMessageStatus = (typeof TERMINAL_MESSAGE_STATUSES)[number];

/** True if `status` is terminal (no further transitions allowed). */
export function isTerminalMessageStatus(
  status: MessageStatus,
): status is TerminalMessageStatus {
  return (TERMINAL_MESSAGE_STATUSES as readonly string[]).includes(status);
}

export const messageStatusGroup = z.enum([
  "active",
  "delivered",
  "failed",
  "unknown",
]);
export type MessageStatusGroup = z.infer<typeof messageStatusGroup>;

/**
 * Dashboard grouping: terminal delivery failures must never appear as queued/in progress — and,
 * equally, an outcome we never observed must not be reported as a failure.
 *
 * `expired` used to group as `failed`. It means "no final DLR arrived within the TTL", which is a
 * statement about OUR visibility, not about the carrier's outcome. A message that reached
 * `accepted` was acknowledged by the provider and stays BILLED by the sweeper — so grouping it as
 * failed told a customer their message failed while charging them for it, and made a missing
 * delivery-report callback look identical to genuine non-delivery. Every live message this platform
 * has sent read as `failed` for exactly that reason.
 *
 * `unknown` keeps it out of both buckets, which is the honest answer: we sent it, we were billed for
 * it, and we did not hear back.
 */
export function messageStatusGroupOf(
  status: MessageStatus,
): MessageStatusGroup {
  if (status === "delivered") return "delivered";
  if (status === "expired") return "unknown";
  if (["undelivered", "failed"].includes(status)) return "failed";
  return "active";
}

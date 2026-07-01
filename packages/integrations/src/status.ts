import type { MessageStatus } from "@app/contracts";

/**
 * Server-side provider-layer helpers. The canonical `MessageStatus` VALUES + terminal set + terminal
 * predicate live in @app/contracts (browser-safe — `message.status` is a public API value the SDK/
 * dev-portal read); import those from there (`messageStatus`, `TERMINAL_MESSAGE_STATUSES`,
 * `isTerminalMessageStatus`). This file adds the server-only bits the provider layer needs: the
 * monotonic rank for out-of-order DLR reconciliation, and the platform-fault vocabulary that drives
 * auto-refund. The commit/refund DECISION is @app/domain, not here.
 */

/**
 * Monotonic rank along the linear happy path (queued→sending→accepted→sent→delivered). Lets the DLR
 * reconciler be OUT-OF-ORDER TOLERANT (F5.4): ignore an incoming status not more advanced than the
 * one already recorded. All FOUR terminals (delivered/undelivered/failed/expired) share `delivered`'s
 * rank — they're alternative ends, not "less advanced" — so pair this with `isTerminalMessageStatus`
 * to freeze on the first terminal (a late terminal never regresses a recorded one). Typed
 * `Record<MessageStatus, number>` so a missing status fails the build (all 8 must be ranked).
 */
export const STATUS_RANK: Record<MessageStatus, number> = {
  queued: 0,
  sending: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  undelivered: 4,
  failed: 4,
  expired: 4,
};

/**
 * Failure causes we are NEVER charged for and NEVER charge the customer for → auto-refund the
 * reservation (SMS-FEATURES §5.A honest-billing model). An adapter maps a raw provider failure onto
 * one of these when it is OUR fault; if it can't, the failure isn't platform-caused. A provider
 * declares which of these it exempts via `SmsSenderPlugin.platformFaultExemptions`.
 */
export const PLATFORM_FAULT_CAUSES = [
  "internal_error", // our bug / infra failure
  "suspension", // account suspended by us
  "fraud_block", // SMS-pumping / AIT block we applied
  "geo_block", // destination not permitted by our config
] as const;

export type PlatformFaultCause = (typeof PLATFORM_FAULT_CAUSES)[number];

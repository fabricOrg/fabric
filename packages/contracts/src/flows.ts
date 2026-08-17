import { z } from "zod";
import { money } from "./money.js";

/**
 * Lighthouse flow (Transactions explorer): one reconciled, audited transaction that runs
 * verify → charge → notify, threaded by a `correlationId`. Money stays exact minor-unit strings.
 * Slice 1 persists the record + posts the real ledger credit for the charge; a real Verify provider
 * and live customer-collection are later, human-gated slices.
 */

export const flowStepStatus = z.enum(["done", "failed", "skipped", "pending"]);
export type FlowStepStatus = z.infer<typeof flowStepStatus>;

/** A single leg of the charge posting (presentation of the double-entry movement). */
export const flowLedgerEntry = z.object({
  account: z.string(),
  label: z.string(),
  direction: z.enum(["debit", "credit"]),
  amount: money,
});
export type FlowLedgerEntry = z.infer<typeof flowLedgerEntry>;

export const transactionRecord = z.object({
  correlationId: z.string(),
  createdAt: z.string(),
  customer: z.string(), // masked E.164
  channel: z.string(),
  amount: money,
  verify: z.object({
    status: flowStepStatus,
    verificationId: z.string().nullable(),
    at: z.string().nullable(),
  }),
  charge: z.object({
    status: flowStepStatus,
    at: z.string().nullable(),
    entries: z.array(flowLedgerEntry),
  }),
  notify: z.object({
    status: flowStepStatus,
    messageId: z.string().nullable(),
    at: z.string().nullable(),
  }),
  audit: z.object({ actor: z.string(), at: z.string() }),
});
export type TransactionRecord = z.infer<typeof transactionRecord>;

/** One day of throughput for the volume trend chart. `volumeMinor` stays an exact integer string. */
export const flowSeriesPoint = z.object({
  date: z.string(),
  volumeMinor: z.string(),
  count: z.number().int().nonnegative(),
});
export type FlowSeriesPoint = z.infer<typeof flowSeriesPoint>;

/** GET /v1/flows — the explorer feed: reconciled list + the daily volume series. */
export const transactionsResponse = z.object({
  transactions: z.array(transactionRecord),
  series: z.array(flowSeriesPoint),
});
export type TransactionsResponse = z.infer<typeof transactionsResponse>;

const msisdn = z.string().regex(/^\+[1-9]\d{7,14}$/, "Valid E.164 required.");
const minorAmount = z.string().regex(/^[1-9]\d*$/, "Amount must be positive.");

/** POST /v1/flows action:"start" — begin a flow: verification is initiated, no money moves yet. */
export const startFlowRequest = z.object({
  action: z.literal("start"),
  msisdn,
  currency: money.shape.currency,
  minor: minorAmount,
  channel: z.string().min(1),
});
export type StartFlowRequest = z.infer<typeof startFlowRequest>;

export const startFlowResponse = z.object({
  correlationId: z.string(),
  verificationId: z.string(),
  otpSentTo: z.string(),
});
export type StartFlowResponse = z.infer<typeof startFlowResponse>;

/** POST /v1/flows action:"confirm" — verify the OTP, then initiate the customer collection. */
export const confirmFlowRequest = z.object({
  action: z.literal("confirm"),
  correlationId: z.string().min(1),
  code: z.string().min(1),
});
export type ConfirmFlowRequest = z.infer<typeof confirmFlowRequest>;

/**
 * confirm result: the record (charge now `pending`) + the hosted-checkout URL to collect from the
 * customer. The Paystack webhook credits the ledger + completes the charge/notify. `authorizationUrl`
 * is null on an idempotent replay (collection already initiated).
 */
export const confirmFlowResponse = z.object({
  record: transactionRecord,
  authorizationUrl: z.string().url().nullable(),
});
export type ConfirmFlowResponse = z.infer<typeof confirmFlowResponse>;

/**
 * `POST /v1/flows` resolves at runtime on `action`: "start" returns a started flow, "confirm" a
 * confirmed one. Composed HERE rather than in an OpenAPI binding — a binding names one contract and
 * must never build shapes, or it becomes the second source of truth this pipeline exists to remove.
 */
export const runFlowResponse = z.union([
  startFlowResponse,
  confirmFlowResponse,
]);
export type RunFlowResponse = z.infer<typeof runFlowResponse>;

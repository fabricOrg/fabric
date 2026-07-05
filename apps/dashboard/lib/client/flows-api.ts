import { z } from "zod";

/**
 * Lighthouse flow client — verify → charge → notify as one reconciled, audited transaction.
 * TODO(BFF): replace the mock with the real saga in services/api (Verify E6 → Paystack collect E4 →
 * double-entry post E3 → send E5), threaded by correlationId + an audit entry. Promote DTOs to
 * @app/contracts. See docs/PI-5/LIGHTHOUSE-FLOW.md.
 */
const money = z.object({
  currency: z.enum(["GHS", "NGN", "USD"]),
  minor: z.string(),
});
export type FlowMoney = z.infer<typeof money>;

const stepStatus = z.enum(["done", "failed", "skipped", "pending"]);
export type StepStatus = z.infer<typeof stepStatus>;

const ledgerEntry = z.object({
  account: z.string(),
  label: z.string(),
  direction: z.enum(["debit", "credit"]),
  amount: money,
});
export type LedgerEntry = z.infer<typeof ledgerEntry>;

export const transactionRecordSchema = z.object({
  correlationId: z.string(),
  createdAt: z.string(),
  customer: z.string(),
  channel: z.string(),
  amount: money,
  verify: z.object({
    status: stepStatus,
    verificationId: z.string().nullable(),
    at: z.string().nullable(),
  }),
  charge: z.object({
    status: stepStatus,
    at: z.string().nullable(),
    entries: z.array(ledgerEntry),
  }),
  notify: z.object({
    status: stepStatus,
    messageId: z.string().nullable(),
    at: z.string().nullable(),
  }),
  audit: z.object({ actor: z.string(), at: z.string() }),
});
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;

const startResponseSchema = z.object({
  correlationId: z.string(),
  verificationId: z.string(),
  otpSentTo: z.string(),
});
export type StartResponse = z.infer<typeof startResponseSchema>;

async function bff(body: unknown): Promise<unknown> {
  const response = await fetch("/api/dashboard/flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function startFlow(input: {
  msisdn: string;
  currency: string;
  minor: string;
  channel: string;
}): Promise<StartResponse> {
  return startResponseSchema.parse(await bff({ action: "start", ...input }));
}

export async function confirmFlow(input: {
  correlationId: string;
  code: string;
  msisdn: string;
  currency: string;
  minor: string;
  channel: string;
}): Promise<TransactionRecord> {
  return transactionRecordSchema.parse(
    await bff({ action: "confirm", ...input }),
  );
}

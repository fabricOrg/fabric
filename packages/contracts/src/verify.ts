// Verify (OTP) public API shapes (V1, ADR-0002 golden path) — the product developers integrate
// first. zod-only, browser-safe. The code itself never appears in a response EXCEPT debug_code on
// sandbox tenants (the quickstart's "see the OTP without a real phone" affordance).

import { z } from "zod";

export const verificationStatus = z.enum([
  "pending",
  "verified",
  "failed",
  "expired",
]);
export type VerificationStatus = z.infer<typeof verificationStatus>;

const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "must be E.164, e.g. +233545227189");

/** POST /v1/verify — start a verification (sends the OTP over SMS). */
export const verifyStartRequest = z.object({
  to: e164,
  /** Sender id on the OTP SMS; defaults to the platform sender. */
  sender_id: z.string().trim().min(1).max(11).optional(),
});
export type VerifyStartRequest = z.infer<typeof verifyStartRequest>;

export const verifyStartResponse = z.object({
  id: z.string().uuid(),
  /** The status AT START. An idempotent replay returns the stored value, so a code that has since
   *  lapsed or been verified still reads `pending` here — retrieve the verification for the live
   *  status, or read `expires_in` / `expires_at`, which ARE recomputed on replay. */
  status: verificationStatus,
  /** Masked recipient, e.g. "+23354•••7189" — the raw number is never echoed. */
  to: z.string(),
  channel: z.literal("sms"),
  /** Seconds left AT THE TIME OF THIS RESPONSE — recomputed on an idempotent replay, and 0 once
   *  the code has lapsed. Drive a countdown from `expires_at` if you cache the response. */
  expires_in: z.number().int().nonnegative(),
  /** Absolute expiry remains truthful when an idempotent start response is replayed later. */
  expires_at: z.string(),
  /** SANDBOX TENANTS ONLY: the OTP, so the quickstart works without a real phone. Never set on
   *  live tenants. */
  debug_code: z.string().optional(),
});
export type VerifyStartResponse = z.infer<typeof verifyStartResponse>;

/** POST /v1/verify/check — present the code the user typed. */
export const verifyCheckRequest = z.object({
  id: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
});
export type VerifyCheckRequest = z.infer<typeof verifyCheckRequest>;

export const verifyCheckResponse = z.object({
  id: z.string().uuid(),
  status: verificationStatus,
  verified_at: z.string().nullable(),
});
export type VerifyCheckResponse = z.infer<typeof verifyCheckResponse>;

// ---- Dashboard overview (V2 surface) — real rollups replacing the mock matrix ------------------
export const verificationSummary = z.object({
  id: z.string().uuid(),
  /** Masked recipient — raw numbers never leave the API. */
  msisdn: z.string(),
  channel: z.literal("sms"),
  status: verificationStatus,
  created_at: z.string(),
  verified_at: z.string().nullable(),
});
export type VerificationSummary = z.infer<typeof verificationSummary>;

export const verifyTrendPoint = z.object({
  /** ISO date (UTC day bucket). */
  date: z.string(),
  attempts: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
});

export const verifyOverviewResponse = z.object({
  recent: z.array(verificationSummary),
  /** Funnel: verified ≤ delivered ≤ sent (sent = verifications started). */
  stats: z.object({
    sent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
  }),
  trend: z.array(verifyTrendPoint),
});
export type VerifyOverviewResponse = z.infer<typeof verifyOverviewResponse>;

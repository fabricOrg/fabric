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
  status: verificationStatus,
  /** Masked recipient, e.g. "+23354•••7189" — the raw number is never echoed. */
  to: z.string(),
  channel: z.literal("sms"),
  expires_in: z.number().int().positive(),
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

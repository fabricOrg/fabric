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

/**
 * Variables Fabric injects into the OTP template and a caller may NEVER supply (ADR-0017 §1a).
 *
 * `code` is the whole point of the primitive: the verification code is generated here, lives in the
 * SMS body and nowhere else, and is never accepted from a caller. A caller who could set it would
 * choose the OTP. `expires_minutes`/`expires_seconds` are derived from the same TTL that governs the
 * stored expiry, so a caller-supplied value would let the message state a lifetime the server does
 * not honour.
 */
export const VERIFY_RESERVED_VARIABLES = [
  "code",
  "expires_minutes",
  "expires_seconds",
] as const;

/** Template variables are scalars: they are substituted into an SMS body, not traversed. */
const verifyVariableValue = z.union([z.string(), z.number(), z.boolean()]);

/** POST /v1/verify — start a verification (sends the OTP over SMS). */
export const verifyStartRequest = z
  .object({
    to: e164,
    /** Sender id on the OTP SMS; defaults to the platform sender. */
    sender_id: z.string().trim().min(1).max(11).optional(),
    /**
     * Stable key of a released, verify-eligible SMS message definition to render instead of the
     * built-in wording. Omit for the platform default. Selected per REQUEST, not per workspace, so
     * one platform can send differently-branded codes for the merchants it resells to (ADR-0017 §1).
     */
    template: z.string().trim().min(1).max(200).optional(),
    /**
     * Caller-supplied values for the template's own variables — a merchant name, for instance.
     * Validated against the definition's declared variable schema. Supplying a reserved name is
     * REFUSED rather than ignored: silently dropping it would let a caller believe they had set the
     * code.
     */
    variables: z.record(z.string(), verifyVariableValue).optional(),
    /** Locale variant to render; falls back to the definition's default locale. */
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "invalid_locale")
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      !v.variables ||
      !VERIFY_RESERVED_VARIABLES.some((name) =>
        Object.hasOwn(v.variables ?? {}, name),
      ),
    {
      message: `Fabric supplies these and they cannot be passed: ${VERIFY_RESERVED_VARIABLES.join(", ")}.`,
      path: ["variables"],
    },
  )
  .refine((v) => !v.variables || v.template !== undefined, {
    message: "`variables` requires `template`.",
    path: ["variables"],
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

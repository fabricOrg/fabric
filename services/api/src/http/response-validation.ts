import type { ZodType } from "zod";

/**
 * Checks a payload against the response contract the OpenAPI document publishes for its route.
 *
 * POSTURE, and it is deliberately environment-dependent:
 *
 *  - NON-PRODUCTION → THROW. A response that does not match its published schema is a defect, and
 *    the moment to learn that is while someone is looking. This is what lets QA treat the reference
 *    as authoritative rather than aspirational.
 *
 *  - PRODUCTION → LOG AND SERVE. A schema mismatch is our bug, not a reason to turn a working
 *    response into a 500 for a customer. CLAUDE.md's availability posture applies: the data plane
 *    does not die because something upstream of it is wrong. The money path is unaffected either
 *    way — validation runs after the work is committed, so it can only change what the caller is
 *    told, never whether the send happened.
 *
 * `OPENAPI_RESPONSE_VALIDATION` overrides both: `strict` | `warn` | `off`. `off` exists for a
 * production incident where the logging itself is the problem, not as a way to silence a failure.
 */

export type ValidationMode = "strict" | "warn" | "off";

export function resolveValidationMode(
  env: NodeJS.ProcessEnv = process.env,
): ValidationMode {
  const configured = env.OPENAPI_RESPONSE_VALIDATION?.trim().toLowerCase();
  if (configured === "strict" || configured === "warn" || configured === "off")
    return configured;
  return env.NODE_ENV === "production" ? "warn" : "strict";
}

export interface ValidationFailure {
  readonly route: string;
  readonly issues: string;
}

/**
 * Used for BOTH directions — a response on the way out, a body or query string on the way in.
 * Returns null when the payload matches (or there is nothing to check), and a described failure
 * when it does not. Deliberately does NOT throw: the caller decides what a failure means, because
 * that decision is the posture above and belongs in one place.
 *
 * The parsed value is discarded on purpose — the ORIGINAL payload is served. Returning zod's output
 * would silently strip unknown keys, so a response carrying a field the contract forgot would be
 * quietly truncated instead of reported. Validation here observes; it does not rewrite.
 */
export function checkPayload(
  contract: ZodType | null,
  payload: unknown,
  route: string,
): ValidationFailure | null {
  if (!contract || payload === undefined || payload === null) return null;
  const result = contract.safeParse(payload);
  if (result.success) return null;
  return {
    route,
    issues: result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; "),
  };
}

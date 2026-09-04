import { HttpStatus } from "@nestjs/common";
import type { z } from "zod";
import { apiError } from "../http/api-error.js";

/**
 * Parse a payload replayed out of the idempotency store, back into its published response type.
 *
 * The stored value crossed a persistence boundary, so it is untrusted input on the way back in — it
 * may have been written by an earlier release whose contract has since changed, or edited by hand.
 * Casting it with `as` hid that; parsing it surfaces it, but a bare `.parse()` throws a ZodError,
 * and there is no global exception filter here, so it left as Nest's default
 * `{statusCode:500,message:"Internal server error"}` — outside the error envelope, with no stable
 * code to branch on, and with the issue list liable to echo stored payload contents into the log.
 *
 * 409 rather than 500 because it is a statement about the KEY, not about the server: this key holds
 * something unreplayable, so use a different one. That is an action the caller can take.
 */
export function replayOrConflict<T extends z.ZodTypeAny>(
  schema: T,
  stored: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(stored);
  if (parsed.success) return parsed.data;
  throw apiError({
    type: "api_error",
    code: "idempotency_replay_unreadable",
    message:
      "The stored response for this Idempotency-Key cannot be replayed. Retry with a new key.",
    status: HttpStatus.CONFLICT,
  });
}

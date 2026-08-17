import { z } from "zod";

/**
 * THE RESPONSE ENVELOPE — one shape for every response this API returns.
 *
 * Success:  { data: <payload>, request_id: "req_…" }
 * Failure:  { error: { type, code, message, param?, doc_url? }, request_id: "req_…" }
 *
 * WHY. Before this, success responses had at least four shapes: a resource at the top level, a
 * named collection key (`switches`, `templates`, `deliveries`), a BARE ARRAY on `/v1/api-keys`, and
 * four different acknowledgement literals. A caller could not write one response handler, QA could
 * not write one assertion helper, and `request_id` — the thing support asks for — was present on
 * some responses and absent from others.
 *
 * The failure shape already had an envelope. This makes success symmetric with it, so `request_id`
 * is on EVERY response and the only question a client asks is whether `error` is present.
 *
 * Breaking, pre-prod, CLAUDE.md §11.
 *
 * NOT ENVELOPED, deliberately:
 *  - non-JSON payloads (the CSV statement export, the plain-text Meta challenge echo) — there is no
 *    object to wrap, and wrapping would corrupt a file download;
 *  - 204 responses, which have no body by definition.
 */

/** Wraps a payload schema in the success envelope. Used by the OpenAPI generator and by clients. */
export function enveloped<T extends z.ZodType>(payload: T) {
  return z.object({
    data: payload,
    request_id: z.string(),
  });
}

/**
 * The envelope with an unknown payload — for a consumer that wants to read `request_id` or check
 * for `error` before it knows (or cares) what `data` holds.
 */
export const responseEnvelope = z.object({
  data: z.unknown(),
  request_id: z.string(),
});
export type ResponseEnvelope<T = unknown> = { data: T; request_id: string };

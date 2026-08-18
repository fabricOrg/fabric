/**
 * Fabric wraps every JSON success in `{ data, request_id }`. The SDK unwraps it once, inside the
 * transport, so every resource module receives the payload it expects — the envelope is a transport
 * concern, not something each caller should destructure.
 *
 * Lives in its own module because `transport.ts` sits against the 300-line guard.
 */

/** `{ data, request_id }` -> `data`. Anything else passes through: a 204 has no body, and a
 *  non-enveloped payload means an endpoint that opts out (a file download). */
export function unwrapEnvelope(payload: unknown): unknown {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "data" in payload &&
    "request_id" in payload
  ) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

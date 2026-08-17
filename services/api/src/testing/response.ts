import { unwrapEnvelope } from "@app/contracts";

/**
 * Read a test response body, unwrapped.
 *
 * Every JSON success carries `{ data, request_id }`, so a spec that asserts on the payload has to
 * unwrap first. `jsonBody(res)` is shorter than `unwrapEnvelope(res.json())` at every call site —
 * which matters, because inlining the longer form pushed four spec files past the 350-line test
 * guard purely on formatting.
 *
 * Error bodies pass through untouched: `unwrapEnvelope` only unwraps when BOTH `data` and
 * `request_id` are present, so `jsonBody(res).error.code` still reads an error envelope correctly.
 */
export function jsonBody(response: { json: () => unknown }): unknown {
  return unwrapEnvelope(response.json());
}

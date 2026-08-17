import "server-only";

/**
 * The API wraps every JSON success in `{ data, request_id }` (see `@app/contracts` envelope.ts).
 *
 * The dashboard and the SDK each unwrap once inside their shared transport. The admin console has
 * no shared transport — every client module calls `fetch` directly — so this helper is the shared
 * piece instead. Worth folding those twelve modules onto one `internalApi()` helper eventually;
 * until then, every `.json()` on a success path goes through here.
 */
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

/** Read a success response and unwrap it. Use on the `response.ok` path only — an error body keeps
 *  its own `{ error, request_id }` envelope and must reach the caller intact. */
export async function readEnvelopedJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  return unwrapEnvelope(await response.json());
}

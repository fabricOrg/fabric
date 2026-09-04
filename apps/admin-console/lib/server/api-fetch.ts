import "server-only";

import { errorEnvelope } from "@app/contracts";

/** Default deadline for a server-to-API call; an upstream stall must not consume a Next worker forever. */
export const API_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Writes that cross a third party (WorkOS invitation, provider call) get a longer budget. They are
 * NOT idempotent, so a deadline short enough to fire on a cold upstream turns one invitation into
 * two: the operator sees a failure, the write landed anyway, and they click again.
 */
export const API_EXTERNAL_WRITE_TIMEOUT_MS = 45_000;

/**
 * A timeout is answered with a real 504 envelope rather than a rejection. Every client module turns
 * a non-2xx into its own `*ApiError` and every route handler forwards that verbatim, so the browser
 * gets a parseable `upstream_timeout` it can branch on — and `resolveStaffSession`, documented to
 * return null on any non-2xx, keeps doing so instead of throwing past the refresh fallback.
 */
function timedOut(timeoutMs: number): Response {
  return Response.json(
    errorEnvelope({
      type: "api_error",
      code: "upstream_timeout",
      message: `The API did not answer within ${Math.round(timeoutMs / 1000)}s. If this was a write it may still have completed — check before retrying.`,
    }),
    { status: 504 },
  );
}

/**
 * An upstream that could not ANSWER is not an identity that was refused. The session resolvers
 * return null on any non-2xx, and `refreshAndClassifyUser` reads null as terminal and DELETES the
 * session cookie — so a 15-second API stall would sign every user out. Resolvers throw this instead,
 * carrying the status the classifier already inspects, which lands in its transient branch and keeps
 * the cookie.
 */
export class UpstreamUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`The API answered ${status} and could not resolve the session.`);
    this.name = "UpstreamUnavailableError";
  }
}

export async function apiFetch(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs: number = API_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    // Only OUR deadline becomes a response. A caller's own abort and a genuine network failure keep
    // rejecting, exactly as they did before this file existed.
    if (!timeout.aborted) throw error;
    return timedOut(timeoutMs);
  }
}

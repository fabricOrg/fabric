/**
 * The session resolver could not reach the API, as distinct from the API refusing the session.
 *
 * `readUserSession` / `readSession` map a refusal — invalid, expired, malformed, unauthorized — to
 * `null`, and every caller reads `null` as terminal: a page redirects to the refresh hop, a mutation
 * route answers 401, and `refreshAndClassifyUser` DELETES the session cookie. That is correct for a
 * refusal and wrong for an outage, where the honest answer is "ask again shortly".
 *
 * Since the BFF gave every server-to-API call a deadline, an upstream stall produces a synthetic 504
 * rather than hanging, so this case is now reachable on every page load. Resolvers throw this and
 * the readers rethrow it, so a 5xx never silently becomes "you are signed out".
 *
 * It lives here rather than in either app because `readUserSession` is in this package and cannot
 * import from an app; both apps re-export it so the class is one identity across the boundary.
 */
export class UpstreamUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`The API answered ${status} and could not resolve the session.`);
    this.name = "UpstreamUnavailableError";
  }
}

/** Structural check: survives duplicate module instances across app/package boundaries. */
export function isUpstreamUnavailable(
  error: unknown,
): error is UpstreamUnavailableError {
  return (
    error instanceof UpstreamUnavailableError ||
    (error instanceof Error && error.name === "UpstreamUnavailableError")
  );
}

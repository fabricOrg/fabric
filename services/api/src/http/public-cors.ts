/** The one prefix whose responses may be read cross-origin. Trailing slash matters — see below. */
const PUBLIC_PREFIX = "/v1/public/";

/**
 * Is this request path part of the deliberately PUBLIC, unauthenticated API surface?
 *
 * Only these responses may carry `Access-Control-Allow-Origin`. The rest of `/v1/*` is the
 * `sk_*`-authenticated data plane and `/internal/*` takes `BFF_INTERNAL_TOKEN`; making either
 * cross-origin readable would hand any page on the internet a way to read a caller's data through
 * their browser. So this is a prefix allowlist, never a global CORS policy.
 *
 * The trailing slash is load-bearing: without it `/v1/publicity` (or any future route that merely
 * starts with the same letters) would inherit public CORS by accident.
 */
export function isPublicApiPath(url: string): boolean {
  // `request.url` carries the query string and, on some proxies, an absolute form. Compare the path
  // alone so `?foo=1` or a host prefix can neither defeat nor widen the match.
  return pathOf(url).startsWith(PUBLIC_PREFIX);
}

function pathOf(url: string): string {
  const queryAt = url.indexOf("?");
  const withoutQuery = queryAt === -1 ? url : url.slice(0, queryAt);
  if (withoutQuery.startsWith("/")) return withoutQuery;
  // Absolute-form request target (RFC 7230 §5.3.2) — take the path component only.
  try {
    return new URL(withoutQuery).pathname;
  } catch {
    // Unparseable target can't be proven public, so it isn't.
    return "";
  }
}

/**
 * Parse `PUBLIC_CORS_ALLOWED_ORIGINS` — a comma-separated list of exact origins
 * (`https://fabric.example`, no path, no trailing slash).
 *
 * FAILS CLOSED: unset or empty means no browser origin is allowed, so a missing config surfaces as
 * "the pricing section is empty" rather than as a silently world-readable endpoint. Values are
 * normalised through `URL` so a trailing slash or stray path in configuration can't quietly stop
 * matching a browser's `Origin` header, which never carries either.
 */
export function parseAllowedOrigins(
  raw: string | undefined,
): ReadonlySet<string> {
  const origins = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter((value) => value.length > 0);
  return new Set(origins);
}

/**
 * The value to echo back in `Access-Control-Allow-Origin`, or null to send no CORS header at all.
 *
 * We echo the caller's own origin rather than returning `*` so only the configured sites can read
 * the response in a browser. That makes the response origin-dependent, which is why the caller MUST
 * also send `Vary: Origin` — without it a shared cache can hand one origin's response (carrying the
 * other's allow-origin value) to a different origin, which both breaks the allowed site and leaks
 * nothing useful but looks alarming in a CDN.
 *
 * A request with no `Origin` header (curl, server-to-server, same-origin) gets no header: CORS is
 * meaningless there, and the endpoint stays readable by them exactly as before. CORS constrains
 * browsers only — it is not, and cannot be, an access control on public data.
 */
export function publicCorsOrigin(
  requestOrigin: string | undefined,
  allowed: ReadonlySet<string>,
): string | null {
  if (!requestOrigin) return null;
  return allowed.has(requestOrigin) ? requestOrigin : null;
}

/**
 * Add `Origin` to an existing `Vary` without discarding what is already there. These responses
 * already vary on `Accept-Encoding` (compression), and replacing that outright would let a cache
 * serve a brotli body to a client that never asked for one. Case-insensitive so an upstream
 * `vary: origin` isn't duplicated.
 */
export function varyWithOrigin(existing: string | undefined): string {
  const tokens = (existing ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.some((token) => token.toLowerCase() === "origin")) {
    return tokens.join(", ");
  }
  return [...tokens, "Origin"].join(", ");
}

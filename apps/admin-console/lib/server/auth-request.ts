import "server-only";

/**
 * ADR-0008: cheap login-CSRF defense for the credential POST routes. A cross-site page could POST
 * attacker-controlled credentials to /api/auth/sign-in and, if it succeeded, plant the ATTACKER's
 * sealed-session cookie in the victim's browser (login CSRF). We reject requests the browser marks
 * cross-site via `Sec-Fetch-Site` (sent by all modern browsers, unforgeable from JS).
 *
 * Allowed: `same-origin` (our own fetch), `same-site` (e.g. dev-portal on a sibling subdomain),
 * and `none`/absent (direct action; our routes are POST-only so this isn't a normal navigation).
 * Rejected: `cross-site`.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "cross-site";
}

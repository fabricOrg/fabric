import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { invalidRequest } from "../http/api-error.js";

/**
 * The environment a webhook management call is confined to, decided by CREDENTIAL KIND.
 *
 * `tenant.environmentId ?? undefined` was the obvious spelling and the wrong one: `undefined`
 * switches the narrowing off entirely, and a null environment does not mean "this caller is allowed
 * everywhere". It means one of two opposite things.
 *
 *  - A BFF tenant token (ADR-0003) legitimately has none. The dashboard names the application and
 *    environment it is acting on, so an unscoped query is correct and tenant containment is the
 *    only guarantee this layer owes.
 *  - A legacy or un-backfilled `sk_*` key ALSO has none, and for that credential unscoped means it
 *    reads, disables and replays across every environment in its tenant — including live endpoints
 *    from a sandbox key. `api-key.guard.ts` warns about precisely this: a management gate must read
 *    `isSessionToken`, never infer session-ness from an absent application or environment.
 *
 * So the two are separated here and the ambiguous case is refused rather than silently widened. A
 * data-plane key that cannot say which environment it belongs to has no business managing webhooks
 * in any of them; the fix is to re-issue it against an application-environment.
 */
export function webhookCallerEnvironment(
  tenant: RequestTenant,
): string | undefined {
  if (tenant.isSessionToken) return undefined;
  if (!tenant.environmentId) {
    throw invalidRequest(
      "scoped_api_key_required",
      "This API key predates application environments, so it cannot manage webhooks. Re-issue it against an application environment.",
    );
  }
  return tenant.environmentId;
}

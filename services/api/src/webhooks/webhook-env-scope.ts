import {
  type ApplicationId,
  applications,
  type EnvironmentId,
  environments,
} from "@app/db";
import { and, eq, type SQL } from "drizzle-orm";

/**
 * Which application-environment a webhook write binds to, by presenting credential (ADR-0004):
 * an `sk_*` key resolves to its EXACT environment; a BFF tenant token names an application and we
 * pick the requested env type within it; otherwise we fall back to the legacy app slugged
 * `default`. Extracted from `webhooks.service.ts` to keep that file under the 300-line guard.
 *
 * Returns only the env-scoping predicate — the caller still ANDs the tenant filter, so a missing
 * or forged scope can never widen the query beyond the tenant.
 */
export function webhookEnvScope(opts: {
  applicationId?: string;
  environmentId?: string;
  envType: "sandbox" | "live";
}): SQL | undefined {
  if (opts.environmentId) {
    return eq(environments.id, opts.environmentId as EnvironmentId);
  }
  if (opts.applicationId) {
    return and(
      eq(applications.id, opts.applicationId as ApplicationId),
      eq(environments.type, opts.envType),
    );
  }
  return and(
    eq(applications.slug, "default"),
    eq(environments.type, opts.envType),
  );
}

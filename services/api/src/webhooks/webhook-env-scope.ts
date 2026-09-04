import {
  type ApplicationId,
  applications,
  type EnvironmentId,
  environments,
} from "@app/db";
import { and, eq, type SQL, sql } from "drizzle-orm";

/**
 * Which application-environment a webhook write binds to, by presenting credential (ADR-0004):
 * an `sk_*` key resolves to its EXACT environment; otherwise the caller supplies an application —
 * either the one it named, or the workspace's primary one (see `primaryApplicationId`) — and we
 * pick the requested env type within it. Extracted from `webhooks.service.ts` to keep that file
 * under the 300-line guard.
 *
 * Returns only the env-scoping predicate — the caller still ANDs the tenant filter, so a missing
 * or forged scope can never widen the query beyond the tenant.
 *
 * This used to fall back to the app slugged `default`, which a workspace is not obliged to have.
 * Resolution moved to the caller (which holds a transaction and can query), leaving this a pure
 * predicate builder.
 */
export function webhookEnvScope(opts: {
  applicationId?: string;
  environmentId?: string;
  envType: "sandbox" | "live";
}): SQL | undefined {
  if (opts.environmentId) {
    // Both narrowings apply when both are present. Letting the environment REPLACE a caller-named
    // application is the same defect `list` carried: the write would bind to the key's environment
    // while silently ignoring the application the caller asked for.
    return and(
      eq(environments.id, opts.environmentId as EnvironmentId),
      opts.applicationId
        ? eq(applications.id, opts.applicationId as ApplicationId)
        : undefined,
    );
  }
  if (opts.applicationId) {
    return and(
      eq(applications.id, opts.applicationId as ApplicationId),
      eq(environments.type, opts.envType),
    );
  }
  // Neither an environment nor an application to scope to — the workspace has no applications at
  // all. Match nothing rather than returning `undefined` (no predicate), which would drop the env
  // filter entirely and bind the webhook to an arbitrary environment. The caller turns the empty
  // result into its own "not found" error.
  return sql`false`;
}

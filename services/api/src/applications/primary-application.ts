import {
  type AppDb,
  type ApplicationId,
  applications,
  type TenantId,
} from "@app/db";
import { asc, eq, sql } from "drizzle-orm";

/** The drizzle transaction handed to a withTenantDrizzle callback. */
type Tx = Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0];

/**
 * The workspace's PRIMARY application — what a request that names no application resolves to.
 *
 * Self-serve provisioning creates one slugged `default` (WorkspaceProvisioningService), and five
 * call sites used to hardcode that slug as their fallback. A workspace is NOT required to have it:
 * applications created through the API, seeds, or ops provisioning carry their own slugs, and such
 * a workspace then failed every no-application path — virtual replies, api-key creation, webhook
 * env scoping, message preview, definition reads — with an error that blamed provisioning for what
 * is a perfectly legal workspace shape.
 *
 * Prefer `default` where it exists, so nothing changes for self-serve workspaces. Otherwise take
 * the oldest application: deterministic, stable as applications are added, and for a single-
 * application workspace simply *the* application. `id` breaks a same-timestamp tie so two callers
 * can never disagree.
 *
 * Returns null only when the workspace has NO applications at all — callers decide whether that is
 * a 404 or a refusal, since the honest message differs per surface.
 */
export async function primaryApplicationId(
  tx: Tx,
  tenantId: string,
): Promise<ApplicationId | null> {
  const [app] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.tenantId, tenantId as TenantId))
    // Boolean DESC puts the `default`-slugged row first in Postgres; the rest is age, then id.
    .orderBy(
      sql`(${applications.slug} = 'default') DESC`,
      asc(applications.createdAt),
      asc(applications.id),
    )
    .limit(1);
  return app?.id ?? null;
}

/**
 * Same resolution for callers holding an `AppDb` rather than an open drizzle transaction (the raw
 * postgres.js paths). A separate read transaction is fine here: the result feeds a subsequent
 * lookup that re-checks tenant ownership anyway, and RLS scopes both.
 */
export async function primaryApplicationIdFor(
  db: AppDb,
  tenantId: string,
): Promise<ApplicationId | null> {
  return db.withTenantDrizzle(tenantId, (tx) =>
    primaryApplicationId(tx, tenantId),
  );
}

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProvisioningDb } from "./provisioning.js";
import type { TenantId } from "./schema/_shared.js";
import { accounts, staffUsers } from "./schema/index.js";

/**
 * One-off cloud bootstrap seed — the minimum for a real login in a fresh environment:
 *   1. an `accounts` row mapped to the WorkOS organization (identity resolve matches on it), and
 *   2. the first `staff_users` admin (admin-console gate).
 * Runs over the app_provisioner connection: the permissive RLS policy (migration 0013) lets it
 * insert `accounts`, and `staff_users` has no RLS. It deliberately does NOT touch api_keys (minted
 * via POST /v1/api-keys) or the wallet (not needed to sign in). Idempotent — safe to re-run.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function runCloudSeed(): Promise<void> {
  const url = requireEnv("DATABASE_URL_PROVISIONER");
  const tenantId =
    process.env.SEED_TENANT_ID ?? "00000000-0000-0000-0000-0000000000d1";
  const workosOrganizationId = process.env.WORKOS_ORGANIZATION_ID?.trim();
  const staffEmails = (process.env.SEED_STAFF_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  const { db, end } = createProvisioningDb(url, { max: 1 });
  try {
    await db
      .insert(accounts)
      .values({
        id: tenantId as TenantId,
        name: "Fabric Testing",
        slug: "fabric-testing",
        ...(workosOrganizationId ? { workosOrganizationId } : {}),
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: "Fabric Testing",
          ...(workosOrganizationId ? { workosOrganizationId } : {}),
        },
      });

    for (const email of staffEmails) {
      await db
        .insert(staffUsers)
        .values({ email, name: "Fabric Operator", role: "admin" })
        .onConflictDoUpdate({
          target: staffUsers.email,
          set: { role: "admin", status: "active" },
        });
    }

    console.log(`Seeded tenant ${tenantId}; staff: ${staffEmails.join(", ")}`);
  } finally {
    await end();
  }
}

function isEntrypoint(
  moduleUrl: string,
  invokedPath = process.argv[1],
): boolean {
  if (!invokedPath) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntrypoint(import.meta.url)) {
  console.log("Starting cloud bootstrap seed.");
  runCloudSeed()
    .then(() => {
      console.log("Cloud bootstrap seed complete.");
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}

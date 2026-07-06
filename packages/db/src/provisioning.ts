import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

/**
 * Cross-tenant identity provisioning connection.
 *
 * This is intentionally separate from AppDb: JIT provisioning must resolve a WorkOS organization
 * before tenant RLS context exists. Only the identity module may use this client, and production
 * must supply a least-privilege provisioning role rather than the general application role.
 */
export function createProvisioningDb(
  url: string,
  options: postgres.Options<Record<string, never>> = {},
) {
  const sql = postgres(url, { max: 2, ...options });
  return {
    db: drizzle(sql, { schema }),
    end: () => sql.end(),
  };
}

export type ProvisioningDb = ReturnType<typeof createProvisioningDb>;

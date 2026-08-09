import type { AppDb } from "@app/db";
import { notFound } from "../http/api-error.js";

type Row = Record<string, unknown>;

export async function resolveWhatsappEnvironment(
  db: AppDb,
  context: {
    tenantId: string;
    environmentId: string;
  },
): Promise<"sandbox" | "live"> {
  const rows = (await db.withTenant(
    context.tenantId,
    (tx) => tx`
      SELECT type FROM environments
      WHERE id = ${context.environmentId} AND tenant_id = ${context.tenantId}
      LIMIT 1`,
  )) as Row[];
  const env = rows[0];
  if (!env) throw notFound("environment_not_found", "Environment not found.");
  return env.type === "sandbox" ? "sandbox" : "live";
}

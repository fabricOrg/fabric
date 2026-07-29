import type { AppDb } from "@app/db";
import { invalidRequest } from "../http/api-error.js";

type Row = Record<string, unknown>;

export async function assertEmailSandboxEnvironment(
  db: AppDb,
  context: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  },
): Promise<void> {
  const rows = (await db.withTenant(
    context.tenantId,
    (tx) => tx`
      SELECT type::text, status::text FROM environments
      WHERE id = ${context.environmentId}
        AND application_id = ${context.applicationId}
      LIMIT 1`,
  )) as Row[];
  const environment = rows[0];
  if (environment?.status !== "active") {
    throw invalidRequest(
      "environment_unavailable",
      "The API key environment is unavailable.",
    );
  }
  if (environment.type !== "sandbox") {
    throw invalidRequest(
      "live_email_not_configured",
      "Live Email requires an approved sending domain and configured provider.",
    );
  }
}

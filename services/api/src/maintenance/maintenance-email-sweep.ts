import type { ProvisioningDb } from "@app/db";
import type { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { EmailService } from "../email/email.service.js";

export async function runEmailSweep(input: {
  tx: Parameters<Parameters<ProvisioningDb["db"]["transaction"]>[0]>[0];
  email: EmailService;
  cutoffIso: string;
  sweptTenants: Record<string, number>;
  logger: Logger;
}): Promise<void> {
  const stuckEmailRows = (await input.tx.execute(
    sql`SELECT DISTINCT m.tenant_id FROM email_messages m
        WHERE m.status IN ('queued','sending','sent')
          AND m.updated_at < ${input.cutoffIso}::timestamptz
          AND EXISTS (
            SELECT 1 FROM message_delivery_attempts a
            WHERE a.email_message_id = m.id
          )`,
  )) as Array<{ tenant_id: string }>;

  for (const row of stuckEmailRows) {
    const tenantId = String(row.tenant_id);
    try {
      const swept = await input.email.sweepStuck(tenantId, input.cutoffIso);
      input.sweptTenants[tenantId] =
        (input.sweptTenants[tenantId] ?? 0) + swept;
      if (swept > 0) {
        input.logger.log(
          `sweeper: resolved ${swept} stuck email message(s) for tenant ${tenantId}`,
        );
      }
    } catch (error) {
      input.logger.error(
        `email sweeper: tenant ${tenantId} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
}

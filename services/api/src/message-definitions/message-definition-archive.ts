import { type AppDb, messageDefinitions, type TenantId } from "@app/db";
import { and, eq } from "drizzle-orm";
import type { AuditService } from "../audit/audit.service.js";
import { notFound } from "../http/api-error.js";
import { auditDefinitionArchive } from "./message-definition-audit.js";

export async function archiveDefinition(
  db: AppDb,
  audit: AuditService,
  tenantId: string,
  definitionId: string,
  actorKeyId: string,
): Promise<void> {
  const archived = await db.withTenantDrizzle(tenantId, async (tx) => {
    const rows = await tx
      .update(messageDefinitions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(messageDefinitions.tenantId, tenantId as TenantId),
          eq(messageDefinitions.id, definitionId),
        ),
      )
      .returning({ id: messageDefinitions.id });
    return rows.length > 0;
  });
  if (!archived) {
    throw notFound("definition_not_found", "No definition with that id.");
  }
  await auditDefinitionArchive({ audit, tenantId, actorKeyId }, definitionId);
}

import type {
  MessageDefinitionState,
  PublishMessageDefinitionRequest,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  environments,
  messageDefinitionReleases,
  messageDefinitions,
  messageDefinitionVersions,
  type TenantId,
} from "@app/db";
import { and, eq } from "drizzle-orm";
import type { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { auditDefinitionPublish } from "./message-definition-audit.js";
import { requireSenderBinding } from "./message-definition-sender-binding.js";
import { readState } from "./message-definitions.reads.js";

export async function publishDefinition(
  db: AppDb,
  audit: AuditService,
  tenantId: string,
  definitionId: string,
  request: PublishMessageDefinitionRequest,
  actorKeyId: string,
): Promise<MessageDefinitionState> {
  if (request.environment !== "sandbox") {
    throw invalidRequest(
      "live_publish_unsupported",
      "Publishing to the live environment is not available yet.",
      "environment",
    );
  }
  const state = await db.withTenantDrizzle(tenantId, async (tx) => {
    const [definition] = await tx
      .select()
      .from(messageDefinitions)
      .where(
        and(
          eq(messageDefinitions.tenantId, tenantId as TenantId),
          eq(messageDefinitions.id, definitionId),
        ),
      )
      .limit(1);
    if (!definition) {
      throw notFound("definition_not_found", "No definition with that id.");
    }
    if (definition.status === "archived") {
      throw invalidRequest(
        "definition_archived",
        "An archived definition cannot be published.",
      );
    }
    const [version] = await tx
      .select({
        id: messageDefinitionVersions.id,
        channel: messageDefinitionVersions.channel,
      })
      .from(messageDefinitionVersions)
      .where(
        and(
          eq(messageDefinitionVersions.id, request.version_id),
          eq(messageDefinitionVersions.definitionId, definitionId),
        ),
      )
      .limit(1);
    if (!version) {
      throw invalidRequest(
        "version_not_found",
        "That version does not belong to this definition.",
        "version_id",
      );
    }
    const [environment] = await tx
      .select({ id: environments.id })
      .from(environments)
      .where(
        and(
          eq(environments.applicationId, definition.applicationId),
          eq(environments.type, "sandbox"),
        ),
      )
      .limit(1);
    if (!environment) {
      throw notFound(
        "environment_not_found",
        "The application has no sandbox environment.",
      );
    }
    if (version.channel === "sms") {
      await requireSenderBinding(tx, definitionId, environment.id);
    }
    await tx
      .insert(messageDefinitionReleases)
      .values({
        tenantId: tenantId as TenantId,
        applicationId: definition.applicationId as ApplicationId,
        environmentId: environment.id,
        definitionId,
        versionId: request.version_id,
      })
      .onConflictDoUpdate({
        target: [
          messageDefinitionReleases.tenantId,
          messageDefinitionReleases.environmentId,
          messageDefinitionReleases.definitionId,
        ],
        set: { versionId: request.version_id, updatedAt: new Date() },
      });
    const [updated] = await tx
      .update(messageDefinitions)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(messageDefinitions.id, definitionId))
      .returning();
    return readState(tx, updated ?? definition);
  });
  await auditDefinitionPublish(
    { audit, tenantId, actorKeyId },
    definitionId,
    request.version_id,
  );
  return state;
}

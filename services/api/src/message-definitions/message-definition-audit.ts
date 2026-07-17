import type { MessageDefinitionState } from "@app/contracts";
import type { AuditService } from "../audit/audit.service.js";

interface AuditContext {
  audit: AuditService;
  tenantId: string;
  actorKeyId: string;
}

export function auditDefinitionCreate(
  context: AuditContext,
  state: MessageDefinitionState,
): Promise<void> {
  return context.audit.record({
    action: "message_definition.create",
    targetType: "message_definition",
    targetId: state.definition.id,
    summary: "Created a managed message definition draft.",
    metadata: {
      tenant_id: context.tenantId,
      application_id: state.definition.application_id,
      version_id: state.latest_version?.id,
      actor_key_id: context.actorKeyId,
    },
  });
}

export function auditDefinitionVersion(
  context: AuditContext,
  state: MessageDefinitionState,
): Promise<void> {
  return context.audit.record({
    action: "message_definition.version.create",
    targetType: "message_definition",
    targetId: state.definition.id,
    summary: "Created an immutable message definition version.",
    metadata: {
      tenant_id: context.tenantId,
      version_id: state.latest_version?.id,
      version: state.latest_version?.version,
      actor_key_id: context.actorKeyId,
    },
  });
}

export function auditDefinitionPublish(
  context: AuditContext,
  definitionId: string,
  versionId: string,
): Promise<void> {
  return context.audit.record({
    action: "message_definition.publish",
    targetType: "message_definition",
    targetId: definitionId,
    summary: "Published a message definition version to sandbox.",
    metadata: {
      tenant_id: context.tenantId,
      version_id: versionId,
      actor_key_id: context.actorKeyId,
    },
  });
}

export function auditDefinitionArchive(
  context: AuditContext,
  definitionId: string,
): Promise<void> {
  return context.audit.record({
    action: "message_definition.archive",
    targetType: "message_definition",
    targetId: definitionId,
    summary: "Archived a message definition.",
    metadata: {
      tenant_id: context.tenantId,
      actor_key_id: context.actorKeyId,
    },
  });
}

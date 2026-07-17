import type {
  MessageDefinition as MessageDefinitionDto,
  MessageDefinitionRelease as MessageDefinitionReleaseDto,
  MessageDefinitionSenderBinding as MessageDefinitionSenderBindingDto,
  MessageDefinitionVersion as MessageDefinitionVersionDto,
} from "@app/contracts";
import type {
  MessageDefinition,
  MessageDefinitionRelease,
  MessageDefinitionSenderBinding,
  MessageDefinitionVersion,
} from "@app/db";

export function toDefinitionDto(row: MessageDefinition): MessageDefinitionDto {
  return {
    id: row.id,
    application_id: row.applicationId,
    key: row.key,
    status:
      row.status === "active"
        ? "active"
        : row.status === "archived"
          ? "archived"
          : "draft",
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toSenderBindingDto(
  row: MessageDefinitionSenderBinding,
): MessageDefinitionSenderBindingDto {
  return {
    id: row.id,
    environment_id: row.environmentId,
    definition_id: row.definitionId,
    sender_id: row.senderId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toVersionDto(
  row: MessageDefinitionVersion,
): MessageDefinitionVersionDto {
  return {
    id: row.id,
    definition_id: row.definitionId,
    version: row.version,
    // Stored jsonb; validated as the closed subset on write, so it round-trips as the DTO shape.
    variable_schema:
      row.variableSchema as MessageDefinitionVersionDto["variable_schema"],
    content: row.content as MessageDefinitionVersionDto["content"],
    default_locale: row.defaultLocale,
    created_at: row.createdAt.toISOString(),
  };
}

export function toReleaseDto(
  row: MessageDefinitionRelease,
): MessageDefinitionReleaseDto {
  return {
    id: row.id,
    environment_id: row.environmentId,
    definition_id: row.definitionId,
    version_id: row.versionId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

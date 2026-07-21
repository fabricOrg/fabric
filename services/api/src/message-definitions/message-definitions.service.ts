import type {
  AddMessageDefinitionVersionRequest,
  CreateMessageDefinitionRequest,
  ListMessageDefinitionsResponse,
  MessageDefinitionState,
  PublishMessageDefinitionRequest,
  SmsVariantContent,
  VariableSchema,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  messageDefinitions,
  messageDefinitionVersions,
  type TenantId,
} from "@app/db";
import { analyzeDefinitionCompatibility } from "@app/domain";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { archiveDefinition } from "./message-definition-archive.js";
import {
  auditDefinitionCreate,
  auditDefinitionVersion,
} from "./message-definition-audit.js";
import { publishDefinition } from "./message-definition-publish.js";
import { bindSandboxSender } from "./message-definition-sender-binding.js";
import {
  latestVersion,
  listDefinitionStates,
  readState,
  resolveApplicationId,
} from "./message-definitions.reads.js";

/** Managed definition mutations; RLS scopes every transaction and the controller gates authority. */
@Injectable()
export class MessageDefinitionsService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    request: CreateMessageDefinitionRequest,
    actorKeyId = "operator",
  ): Promise<MessageDefinitionState> {
    const state = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      const appId = await resolveApplicationId(
        tx,
        tenantId,
        request.application_id,
      );
      const [definition] = await tx
        .insert(messageDefinitions)
        .values({
          tenantId: tenantId as TenantId,
          applicationId: appId as ApplicationId,
          key: request.key,
          status: "draft",
        })
        .onConflictDoNothing()
        .returning();
      if (!definition) {
        throw invalidRequest(
          "definition_key_taken",
          "A definition with that key already exists in this application.",
          "key",
        );
      }
      const [version] = await tx
        .insert(messageDefinitionVersions)
        .values({
          tenantId: tenantId as TenantId,
          definitionId: definition.id,
          applicationId: appId as ApplicationId,
          version: 1,
          variableSchema: request.variable_schema,
          content: request.content,
          defaultLocale: request.default_locale,
        })
        .returning();
      if (!version)
        throw invalidRequest(
          "definition_version_create_failed",
          "The definition version could not be created.",
        );
      await bindSandboxSender(tx, {
        tenantId,
        applicationId: appId,
        definitionId: definition.id,
        senderId: request.sender_id,
      });
      return readState(tx, definition);
    });
    await auditDefinitionCreate(
      { audit: this.audit, tenantId, actorKeyId },
      state,
    );
    return state;
  }

  async list(
    tenantId: string,
    applicationId?: string,
  ): Promise<ListMessageDefinitionsResponse> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const containedApplicationId = applicationId
        ? await resolveApplicationId(tx, tenantId, applicationId)
        : undefined;
      return listDefinitionStates(tx, tenantId, containedApplicationId);
    });
  }

  async addVersion(
    tenantId: string,
    definitionId: string,
    request: AddMessageDefinitionVersionRequest,
    actorKeyId = "operator",
  ): Promise<MessageDefinitionState> {
    const state = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      const [definition] = await tx
        .select()
        .from(messageDefinitions)
        .where(
          and(
            eq(messageDefinitions.tenantId, tenantId as TenantId),
            eq(messageDefinitions.id, definitionId),
          ),
        )
        .limit(1)
        .for("update");
      if (!definition) {
        throw notFound("definition_not_found", "No definition with that id.");
      }
      if (definition.status === "archived") {
        throw invalidRequest(
          "definition_archived",
          "An archived definition cannot receive new versions.",
        );
      }
      const latest = await latestVersion(tx, definitionId);
      if (!latest) {
        throw notFound(
          "definition_version_not_found",
          "The definition has no version to edit.",
        );
      }

      // A breaking schema change must use a NEW stable key (slice-0 §3), so stale-catalog callers
      // aren't silently broken.
      const releasedContent = latest.content as SmsVariantContent;
      const compat = analyzeDefinitionCompatibility(
        latest.variableSchema as VariableSchema,
        request.variable_schema,
        [latest.defaultLocale, ...Object.keys(releasedContent.locales ?? {})],
        [request.default_locale, ...Object.keys(request.content.locales)],
        // Add-version authoring is SMS-only in this slice; the candidate content is always SMS.
        latest.channel,
        "sms",
      );
      if (compat.verdict === "breaking") {
        throw invalidRequest(
          "breaking_change_requires_new_key",
          `Schema change is breaking (${compat.breaking
            .map((c) => `${c.path || "<root>"}:${c.code}`)
            .join(", ")}). Publish it under a new stable key instead.`,
          "variable_schema",
        );
      }
      const [version] = await tx
        .insert(messageDefinitionVersions)
        .values({
          tenantId: tenantId as TenantId,
          definitionId,
          applicationId: definition.applicationId as ApplicationId,
          version: latest.version + 1,
          variableSchema: request.variable_schema,
          content: request.content,
          defaultLocale: request.default_locale,
        })
        .returning();
      if (!version)
        throw invalidRequest(
          "definition_version_create_failed",
          "The definition version could not be created.",
        );
      await bindSandboxSender(tx, {
        tenantId,
        applicationId: definition.applicationId,
        definitionId,
        senderId: request.sender_id,
      });
      return readState(tx, definition);
    });
    await auditDefinitionVersion(
      { audit: this.audit, tenantId, actorKeyId },
      state,
    );
    return state;
  }

  async publish(
    tenantId: string,
    definitionId: string,
    request: PublishMessageDefinitionRequest,
    actorKeyId: string,
  ): Promise<MessageDefinitionState> {
    return publishDefinition(
      this.db,
      this.audit,
      tenantId,
      definitionId,
      request,
      actorKeyId,
    );
  }

  async archive(
    tenantId: string,
    definitionId: string,
    actorKeyId: string,
  ): Promise<void> {
    await archiveDefinition(
      this.db,
      this.audit,
      tenantId,
      definitionId,
      actorKeyId,
    );
  }
}

import type {
  AddMessageDefinitionVersionRequest,
  CreateMessageDefinitionRequest,
  ListMessageDefinitionsResponse,
  MessageDefinitionState,
  PublishMessageDefinitionRequest,
  VariableSchema,
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
import { analyzeCompatibility } from "@app/domain";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { archiveDefinition } from "./message-definition-archive.js";
import {
  auditDefinitionCreate,
  auditDefinitionPublish,
  auditDefinitionVersion,
} from "./message-definition-audit.js";
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
    return this.db.withTenantDrizzle(tenantId, (tx) =>
      listDefinitionStates(tx, tenantId, applicationId),
    );
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
      const compat = analyzeCompatibility(
        latest.variableSchema as VariableSchema,
        request.variable_schema,
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
    if (request.environment !== "sandbox") {
      throw invalidRequest(
        "live_publish_unsupported",
        "Publishing to the live environment is not available yet.",
        "environment",
      );
    }
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
        .select({ id: messageDefinitionVersions.id })
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
      const [env] = await tx
        .select({ id: environments.id })
        .from(environments)
        .where(
          and(
            eq(environments.applicationId, definition.applicationId),
            eq(environments.type, "sandbox"),
          ),
        )
        .limit(1);
      if (!env) {
        throw notFound(
          "environment_not_found",
          "The application has no sandbox environment.",
        );
      }
      // Upsert the single (env, definition) release pointer to the chosen version.
      await tx
        .insert(messageDefinitionReleases)
        .values({
          tenantId: tenantId as TenantId,
          applicationId: definition.applicationId as ApplicationId,
          environmentId: env.id,
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
      { audit: this.audit, tenantId, actorKeyId },
      definitionId,
      request.version_id,
    );
    return state;
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

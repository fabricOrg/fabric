import type { MessageDefinitionState } from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  applications,
  type MessageDefinition,
  type MessageDefinitionVersion,
  messageDefinitionReleases,
  messageDefinitionVersions,
  type TenantId,
} from "@app/db";
import { and, desc, eq } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";
import {
  toDefinitionDto,
  toReleaseDto,
  toVersionDto,
} from "./message-definition-dto.js";

/** The drizzle transaction handed to a withTenantDrizzle callback. */
type Tx = Parameters<Parameters<AppDb["withTenantDrizzle"]>[1]>[0];

/** Resolve the target application id: an explicit one (must belong to the tenant) or the default. */
export async function resolveApplicationId(
  tx: Tx,
  tenantId: string,
  applicationId?: string,
): Promise<string> {
  const [app] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.tenantId, tenantId as TenantId),
        applicationId
          ? eq(applications.id, applicationId as ApplicationId)
          : eq(applications.slug, "default"),
      ),
    )
    .limit(1);
  if (!app) {
    throw invalidRequest(
      "application_not_found",
      "No such application in this workspace.",
      "application_id",
    );
  }
  return app.id;
}

export async function latestVersion(
  tx: Tx,
  definitionId: string,
): Promise<MessageDefinitionVersion | null> {
  const [row] = await tx
    .select()
    .from(messageDefinitionVersions)
    .where(eq(messageDefinitionVersions.definitionId, definitionId))
    .orderBy(desc(messageDefinitionVersions.version))
    .limit(1);
  return row ?? null;
}

/** Assemble the public state (definition + latest version + releases) for one definition row. */
export async function readState(
  tx: Tx,
  definition: MessageDefinition,
): Promise<MessageDefinitionState> {
  const latest = await latestVersion(tx, definition.id);
  const releases = await tx
    .select()
    .from(messageDefinitionReleases)
    .where(eq(messageDefinitionReleases.definitionId, definition.id));
  return {
    definition: toDefinitionDto(definition),
    latest_version: latest ? toVersionDto(latest) : null,
    releases: releases.map(toReleaseDto),
  };
}

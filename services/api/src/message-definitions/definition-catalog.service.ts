import { createHash } from "node:crypto";
import {
  DEFINITION_CATALOG_CLI_CONTRACT_VERSION,
  DEFINITION_CATALOG_MANIFEST_VERSION,
  DEFINITION_CATALOG_SDK_CONTRACT_VERSION,
  type DefinitionCatalogEntry,
  type DefinitionCatalogManifest,
  messageChannel,
  type VariableSchema,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  type EnvironmentId,
  environments,
  messageDefinitionReleases,
  messageDefinitions,
  messageDefinitionVersions,
  type TenantId,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";

@Injectable()
export class DefinitionCatalogService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async read(input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  }): Promise<DefinitionCatalogManifest> {
    return this.db.withTenantDrizzle(input.tenantId, async (tx) => {
      const [environment] = await tx
        .select({ id: environments.id, type: environments.type })
        .from(environments)
        .where(
          and(
            eq(environments.id, input.environmentId as EnvironmentId),
            eq(
              environments.applicationId,
              input.applicationId as ApplicationId,
            ),
            eq(environments.tenantId, input.tenantId as TenantId),
          ),
        )
        .limit(1);
      if (!environment) {
        throw notFound(
          "catalog_environment_not_found",
          "The API key environment is not available.",
        );
      }
      const rows = await tx
        .select({
          key: messageDefinitions.key,
          version: messageDefinitionVersions.version,
          channel: messageDefinitionVersions.channel,
          defaultLocale: messageDefinitionVersions.defaultLocale,
          variableSchema: messageDefinitionVersions.variableSchema,
          content: messageDefinitionVersions.content,
        })
        .from(messageDefinitionReleases)
        .innerJoin(
          messageDefinitions,
          eq(messageDefinitionReleases.definitionId, messageDefinitions.id),
        )
        .innerJoin(
          messageDefinitionVersions,
          eq(messageDefinitionReleases.versionId, messageDefinitionVersions.id),
        )
        .where(
          and(
            eq(messageDefinitionReleases.tenantId, input.tenantId as TenantId),
            eq(
              messageDefinitionReleases.applicationId,
              input.applicationId as ApplicationId,
            ),
            eq(
              messageDefinitionReleases.environmentId,
              input.environmentId as EnvironmentId,
            ),
          ),
        )
        .orderBy(asc(messageDefinitions.key));
      const definitions = rows.map(toEntry);
      return {
        manifest_version: DEFINITION_CATALOG_MANIFEST_VERSION,
        minimum_sdk_contract_version: DEFINITION_CATALOG_SDK_CONTRACT_VERSION,
        minimum_cli_contract_version: DEFINITION_CATALOG_CLI_CONTRACT_VERSION,
        application: { id: input.applicationId },
        environment: { id: environment.id, type: environment.type },
        compatibility_digest: digest(definitions),
        definitions,
      };
    });
  }
}

function toEntry(row: {
  key: string;
  version: number;
  channel: string;
  defaultLocale: string;
  variableSchema: unknown;
  content: unknown;
}): DefinitionCatalogEntry {
  // Both SMS and Email variant content carry a `locales` record — read it channel-agnostically.
  const content = row.content as { locales: Record<string, unknown> };
  return {
    key: row.key,
    version: row.version,
    // The drizzle column types as string; parse through the enum to narrow (the DB CHECK already
    // constrains it to sms|email, so this never throws in practice).
    channels: [messageChannel.parse(row.channel)],
    default_locale: row.defaultLocale,
    locales: [row.defaultLocale, ...Object.keys(content.locales)].sort(),
    data_schema: row.variableSchema as VariableSchema,
  };
}

function digest(definitions: DefinitionCatalogEntry[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(definitions)))
    .digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

import { z } from "zod";
import { apiKeyEnv } from "./dev-portal.js";
import { stableKey, variableSchema } from "./message-definitions.js";

export const DEFINITION_CATALOG_MANIFEST_VERSION = 1 as const;
export const DEFINITION_CATALOG_SDK_CONTRACT_VERSION = 1 as const;
export const DEFINITION_CATALOG_CLI_CONTRACT_VERSION = 1 as const;

export const definitionCatalogEntry = z.object({
  key: stableKey,
  version: z.number().int().positive(),
  channels: z.tuple([z.literal("sms")]),
  default_locale: z.string(),
  locales: z.array(z.string()).min(1),
  data_schema: variableSchema,
});
export type DefinitionCatalogEntry = z.infer<typeof definitionCatalogEntry>;

export const definitionCatalogManifest = z.object({
  manifest_version: z.literal(DEFINITION_CATALOG_MANIFEST_VERSION),
  minimum_sdk_contract_version: z.number().int().positive(),
  minimum_cli_contract_version: z.number().int().positive(),
  application: z.object({ id: z.string().uuid() }),
  environment: z.object({ id: z.string().uuid(), type: apiKeyEnv }),
  compatibility_digest: z.string().regex(/^[a-f0-9]{64}$/),
  definitions: z.array(definitionCatalogEntry),
});
export type DefinitionCatalogManifest = z.infer<
  typeof definitionCatalogManifest
>;

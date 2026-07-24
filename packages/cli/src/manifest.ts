import { z } from "zod";

export const SUPPORTED_MANIFEST_VERSION = 1;
export const CLI_CONTRACT_VERSION = 1;
export const SDK_CONTRACT_VERSION = 1;

export type FieldSchema = {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  enum?: ReadonlyArray<string | number | boolean> | undefined;
  nullable?: boolean | undefined;
  properties?: Readonly<Record<string, FieldSchema>> | undefined;
  required?: ReadonlyArray<string> | undefined;
  items?: FieldSchema | undefined;
};

const fieldSchema: z.ZodType<FieldSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "string",
        "number",
        "integer",
        "boolean",
        "object",
        "array",
      ]),
      enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      nullable: z.boolean().optional(),
      properties: z.record(z.string(), fieldSchema).optional(),
      required: z.array(z.string()).optional(),
      items: fieldSchema.optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      pattern: z.string().optional(),
      format: z.string().optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      additionalProperties: z.literal(false).optional(),
    })
    .strict(),
);

const manifestSchema = z
  .object({
    manifest_version: z.number().int().positive(),
    minimum_sdk_contract_version: z.number().int().positive(),
    minimum_cli_contract_version: z.number().int().positive(),
    application: z.object({ id: z.string().uuid() }).strict(),
    environment: z
      .object({ id: z.string().uuid(), type: z.enum(["sandbox", "live"]) })
      .strict(),
    compatibility_digest: z.string().regex(/^[a-f0-9]{64}$/),
    definitions: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/),
          version: z.number().int().positive(),
          channels: z.array(z.enum(["sms", "email"])).min(1),
          default_locale: z.string(),
          locales: z.array(z.string()).min(1),
          data_schema: fieldSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type DefinitionManifest = z.infer<typeof manifestSchema>;

export function parseManifest(value: unknown): DefinitionManifest {
  const version = manifestVersion(value);
  if (version > SUPPORTED_MANIFEST_VERSION) {
    throw new Error(
      `Catalog schema v${version} requires a newer @fabric-messaging/cli. Upgrade the CLI and run again.`,
    );
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Fabric returned an invalid definition catalog.");
  }
  if (parsed.data.minimum_cli_contract_version > CLI_CONTRACT_VERSION) {
    throw new Error(
      `Catalog requires CLI contract v${parsed.data.minimum_cli_contract_version}. Upgrade @fabric-messaging/cli.`,
    );
  }
  if (parsed.data.minimum_sdk_contract_version > SDK_CONTRACT_VERSION) {
    throw new Error(
      `Catalog requires SDK contract v${parsed.data.minimum_sdk_contract_version}. Upgrade @fabric-messaging/sdk before generating.`,
    );
  }
  return parsed.data;
}

function manifestVersion(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const version = Reflect.get(value, "manifest_version");
  return typeof version === "number" && Number.isInteger(version) ? version : 0;
}

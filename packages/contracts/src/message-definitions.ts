import { z } from "zod";
import { withoutDuplicateDefaultLocale } from "./message-definition-locale.js";
import { messageClass } from "./sms.js";

/**
 * MANAGED MESSAGE DEFINITIONS contracts (SDK-003). Shapes + validation only — no logic (the
 * compatibility algorithm lives in @app/domain). Encodes the stable-key grammar and the portable,
 * closed variable-schema subset locked in docs/sdk/sdk-003-slice0-design.md.
 */

// ---- Stable key (slice-0 §1) --------------------------------------------------------------------
// Dotted lowercase; segment = [a-z][a-z0-9]*(-[a-z0-9]+)*; <=8 segments; <=128 chars; reserved
// `fabric.` prefix rejected. Uniqueness is per application and case-insensitive (enforced in the DB).
const STABLE_KEY_SEGMENT = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const STABLE_KEY_RE = new RegExp(
  `^${STABLE_KEY_SEGMENT}(?:\\.${STABLE_KEY_SEGMENT})*$`,
);

export const stableKey = z
  .string()
  .min(1)
  .max(128)
  .regex(STABLE_KEY_RE, "invalid_stable_key")
  .refine((k) => k.split(".").length <= 8, "stable_key_too_many_segments")
  .refine((k) => !k.toLowerCase().startsWith("fabric."), "stable_key_reserved");
export type StableKey = z.infer<typeof stableKey>;

// ---- Portable variable-schema subset (slice-0 §2) -----------------------------------------------
export const variableFormats = [
  "email",
  "e164",
  "url",
  "date",
  "datetime",
  "uuid",
] as const;
export const variableFormat = z.enum(variableFormats);

// Bounds (hard caps from slice-0 §2). Exceeding any is an authoring error, never silently clamped.
export const VARIABLE_SCHEMA_LIMITS = {
  maxStringLength: 4096,
  maxEnumMembers: 64,
  maxArrayItems: 1000,
  maxObjectProperties: 64,
  maxDepth: 5,
  maxSerializedBytes: 32_768,
} as const;

const stringNode = z
  .object({
    type: z.literal("string"),
    minLength: z
      .int()
      .min(0)
      .max(VARIABLE_SCHEMA_LIMITS.maxStringLength)
      .optional(),
    maxLength: z
      .int()
      .min(1)
      .max(VARIABLE_SCHEMA_LIMITS.maxStringLength)
      .optional(),
    enum: z
      .array(z.string())
      .min(1)
      .max(VARIABLE_SCHEMA_LIMITS.maxEnumMembers)
      .optional(),
    format: variableFormat.optional(),
  })
  .strict();
const integerNode = z
  .object({
    type: z.literal("integer"),
    minimum: z.int().optional(),
    maximum: z.int().optional(),
  })
  .strict();
const numberNode = z
  .object({
    type: z.literal("number"),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .strict();
const booleanNode = z.object({ type: z.literal("boolean") }).strict();

// Object/array nodes are recursive; z.lazy breaks the cycle. `additionalProperties`, when present,
// must be literal false — the subset only admits closed objects.
export type VariableSchemaNode =
  | z.infer<typeof stringNode>
  | z.infer<typeof integerNode>
  | z.infer<typeof numberNode>
  | z.infer<typeof booleanNode>
  | {
      type: "array";
      items: VariableSchemaNode;
      maxItems: number;
      minItems?: number | undefined;
    }
  | {
      type: "object";
      properties: Record<string, VariableSchemaNode>;
      required?: string[] | undefined;
      additionalProperties?: false | undefined;
    };

const variableSchemaNode: z.ZodType<VariableSchemaNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    stringNode,
    integerNode,
    numberNode,
    booleanNode,
    z
      .object({
        type: z.literal("array"),
        items: variableSchemaNode,
        maxItems: z.int().min(1).max(VARIABLE_SCHEMA_LIMITS.maxArrayItems),
        minItems: z.int().min(0).optional(),
      })
      .strict(),
    objectNode,
  ]),
);

const objectNode = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), variableSchemaNode),
    required: z.array(z.string()).optional(),
    additionalProperties: z.literal(false).optional(),
  })
  .strict();

// The document root MUST be an object. Bounded checks (depth, total properties, serialized size) are
// applied here as path-coded issues so the whole subset validates in one place.
export const variableSchema = objectNode.superRefine((doc, ctx) => {
  const serialized = JSON.stringify(doc);
  if (serialized.length > VARIABLE_SCHEMA_LIMITS.maxSerializedBytes) {
    ctx.addIssue({
      code: "custom",
      message: "variable_schema_too_large",
      path: [],
    });
  }
  walkBounds(doc, [], 1, ctx);
});
export type VariableSchema = z.infer<typeof objectNode>;

function walkBounds(
  node: VariableSchemaNode,
  path: (string | number)[],
  depth: number,
  ctx: z.RefinementCtx,
): void {
  if (depth > VARIABLE_SCHEMA_LIMITS.maxDepth) {
    ctx.addIssue({ code: "custom", message: "variable_schema_too_deep", path });
    return;
  }
  if (node.type === "object") {
    const names = Object.keys(node.properties);
    if (names.length > VARIABLE_SCHEMA_LIMITS.maxObjectProperties) {
      ctx.addIssue({ code: "custom", message: "too_many_properties", path });
    }
    for (const name of node.required ?? []) {
      if (!(name in node.properties)) {
        ctx.addIssue({
          code: "custom",
          message: "required_unknown_property",
          path: [...path, name],
        });
      }
    }
    for (const [name, child] of Object.entries(node.properties)) {
      walkBounds(child, [...path, name], depth + 1, ctx);
    }
    return;
  }
  if (node.type === "array") {
    walkBounds(node.items, [...path, "items"], depth + 1, ctx);
  }
}

// ---- Resource DTOs ------------------------------------------------------------------------------
export const messageDefinitionStatus = z.enum(["draft", "active", "archived"]);
export type MessageDefinitionStatus = z.infer<typeof messageDefinitionStatus>;

export const localeTag = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "invalid_locale");

// SMS variant content of a version. One channel today; the shape leaves room for more.
export const smsVariantContent = z.object({
  body: z.string().min(1).max(1600),
  class: messageClass.default("transactional"),
  locales: z
    .record(localeTag, z.object({ body: z.string().min(1).max(1600) }).strict())
    .default({}),
});
export type SmsVariantContent = z.infer<typeof smsVariantContent>;

export const messageDefinition = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  key: stableKey,
  status: messageDefinitionStatus,
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinition = z.infer<typeof messageDefinition>;

export const messageDefinitionVersion = z.object({
  id: z.string().uuid(),
  definition_id: z.string().uuid(),
  version: z.int().min(1),
  variable_schema: variableSchema,
  content: smsVariantContent,
  default_locale: localeTag,
  created_at: z.string(),
});
export type MessageDefinitionVersion = z.infer<typeof messageDefinitionVersion>;

export const messageDefinitionRelease = z.object({
  id: z.string().uuid(),
  environment_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  version_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinitionRelease = z.infer<typeof messageDefinitionRelease>;

export const messageDefinitionSenderBinding = z.object({
  id: z.string().uuid(),
  environment_id: z.string().uuid(),
  definition_id: z.string().uuid(),
  sender_id: z.string().trim().min(1).max(11),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MessageDefinitionSenderBinding = z.infer<
  typeof messageDefinitionSenderBinding
>;

export const definitionEnvironment = z.enum(["sandbox", "live"]);
export type DefinitionEnvironment = z.infer<typeof definitionEnvironment>;

// Author a draft (management path, SDK-003 slice 4). Content + schema authored together. Targets the
// workspace default application unless application_id is given.
export const createMessageDefinitionRequest = z
  .object({
    application_id: z.string().uuid().optional(),
    key: stableKey,
    variable_schema: variableSchema,
    content: smsVariantContent,
    default_locale: localeTag,
    sender_id: z.string().trim().min(1).max(11),
  })
  .superRefine(withoutDuplicateDefaultLocale);
export type CreateMessageDefinitionRequest = z.infer<
  typeof createMessageDefinitionRequest
>;

// Add a new immutable version to an existing definition. Rejected server-side if the schema change is
// breaking versus the latest version (a breaking change must use a new stable key — slice-0 §3).
export const addMessageDefinitionVersionRequest = z
  .object({
    variable_schema: variableSchema,
    content: smsVariantContent,
    default_locale: localeTag,
  })
  .superRefine(withoutDuplicateDefaultLocale);
export type AddMessageDefinitionVersionRequest = z.infer<
  typeof addMessageDefinitionVersionRequest
>;

// Publish an immutable version to an environment. SDK-003 keeps live promotion absent — only sandbox
// is accepted here; the API rejects `live` until the live path lands (SDK-006).
export const publishMessageDefinitionRequest = z.object({
  environment: definitionEnvironment,
  version_id: z.string().uuid(),
});
export type PublishMessageDefinitionRequest = z.infer<
  typeof publishMessageDefinitionRequest
>;

// A definition with its latest version and current environment releases (list/detail response).
export const messageDefinitionState = z.object({
  definition: messageDefinition,
  latest_version: messageDefinitionVersion.nullable(),
  releases: z.array(messageDefinitionRelease),
  sender_bindings: z.array(messageDefinitionSenderBinding),
});
export type MessageDefinitionState = z.infer<typeof messageDefinitionState>;

export const listMessageDefinitionsResponse = z.object({
  definitions: z.array(messageDefinitionState),
});
export type ListMessageDefinitionsResponse = z.infer<
  typeof listMessageDefinitionsResponse
>;

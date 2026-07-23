import { z } from "zod";

/**
 * Portable, closed variable-schema subset (SDK-003 slice-0 §2) — the JSON-Schema dialect a managed
 * definition's variables may use. Split out of message-definitions.ts to stay under the file-length
 * guard; re-exported from ./message-definitions.js so import paths are unchanged.
 */

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

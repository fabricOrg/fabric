import type {
  SmsTemplate,
  VariableSchema,
  VariableSchemaNode,
} from "@app/contracts";
import { variableSchema } from "@app/contracts";
import { extractTokens } from "@app/domain";

export type AuthoringVariableType = "string" | "integer" | "number" | "boolean";

export interface AuthoringVariable {
  readonly id: string;
  readonly name: string;
  readonly type: AuthoringVariableType;
  readonly required: boolean;
  readonly sourceNode?: VariableSchemaNode;
}

export function variablesFromBody(
  body: string,
  current: readonly AuthoringVariable[] = [],
): AuthoringVariable[] {
  const byName = new Map(current.map((field) => [field.name, field]));
  for (const name of extractTokens(body)) {
    if (!byName.has(name)) {
      byName.set(name, {
        id: crypto.randomUUID(),
        name,
        type: "string",
        required: true,
      });
    }
  }
  return [...byName.values()];
}

export function buildVariableSchema(fields: readonly AuthoringVariable[]): {
  schema: VariableSchema | null;
  error: string | null;
} {
  const root: MutableObjectNode = {
    type: "object",
    properties: {},
    required: [],
  };
  for (const field of fields) {
    const segments = field.name.trim().split(".");
    if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
      return {
        schema: null,
        error: `“${field.name}” must be a name or dotted path, such as customer.name.`,
      };
    }
    let parent = root;
    for (const [index, segment] of segments.entries()) {
      const leaf = index === segments.length - 1;
      if (field.required && !parent.required.includes(segment)) {
        parent.required.push(segment);
      }
      const existing = parent.properties[segment];
      if (leaf) {
        if (existing?.type === "object") {
          return {
            schema: null,
            error: `“${field.name}” conflicts with a nested variable.`,
          };
        }
        parent.properties[segment] =
          field.sourceNode?.type === field.type
            ? field.sourceNode
            : { type: field.type };
        continue;
      }
      if (existing && existing.type !== "object") {
        return {
          schema: null,
          error: `“${field.name}” conflicts with “${segments.slice(0, index + 1).join(".")}”.`,
        };
      }
      const child = existing ?? {
        type: "object",
        properties: {},
        required: [],
      };
      parent.properties[segment] = child;
      parent = child as MutableObjectNode;
    }
  }
  const parsed = variableSchema.safeParse(stripEmptyRequired(root));
  return parsed.success
    ? { schema: parsed.data, error: null }
    : {
        schema: null,
        error:
          parsed.error.issues[0]?.message ?? "The variable schema is invalid.",
      };
}

export function samplePayload(
  fields: readonly AuthoringVariable[],
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.id] ?? defaultSample(field);
    const value = parseSample(raw, field.type);
    setDotted(root, field.name, value);
  }
  return root;
}

export function variablesFromSchema(
  schema: VariableSchema,
): AuthoringVariable[] {
  const fields: AuthoringVariable[] = [];
  collectSchemaVariables(schema, "", true, fields);
  return fields;
}

export function supportsVisualSchema(schema: VariableSchema): boolean {
  return Object.values(schema.properties).every(supportsVisualNode);
}

export function templateToDefinitionDraft(template: SmsTemplate): {
  key: string;
  body: string;
  variables: AuthoringVariable[];
} {
  return {
    key: template.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 128),
    body: template.body,
    variables: variablesFromBody(template.body),
  };
}

function defaultSample(field: AuthoringVariable): string {
  if (field.type === "boolean") return "true";
  if (field.type === "integer" || field.type === "number") return "1";
  return `Sample ${field.name.split(".").at(-1) ?? "value"}`;
}

function parseSample(raw: string, type: AuthoringVariableType): unknown {
  if (type === "boolean") return raw.toLowerCase() === "true";
  if (type === "integer" || type === "number") return Number(raw);
  return raw;
}

function collectSchemaVariables(
  node: VariableSchemaNode,
  prefix: string,
  parentRequired: boolean,
  fields: AuthoringVariable[],
): void {
  if (node.type === "object") {
    const required = new Set(node.required ?? []);
    for (const [name, child] of Object.entries(node.properties)) {
      collectSchemaVariables(
        child,
        prefix ? `${prefix}.${name}` : name,
        parentRequired && required.has(name),
        fields,
      );
    }
    return;
  }
  if (node.type === "array") return;
  fields.push({
    id: crypto.randomUUID(),
    name: prefix,
    type: node.type,
    required: parentRequired,
    sourceNode: node,
  });
}

function supportsVisualNode(node: VariableSchemaNode): boolean {
  if (node.type === "array") return false;
  if (node.type !== "object") return true;
  return Object.values(node.properties).every(supportsVisualNode);
}

function setDotted(
  target: Record<string, unknown>,
  dotted: string,
  value: unknown,
): void {
  const segments = dotted.split(".");
  let current = target;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const child = current[segment];
    if (typeof child === "object" && child !== null && !Array.isArray(child)) {
      current = child as Record<string, unknown>;
      continue;
    }
    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }
}

interface MutableObjectNode {
  type: "object";
  properties: Record<string, VariableSchemaNode>;
  required: string[];
}

function stripEmptyRequired(node: MutableObjectNode): VariableSchemaNode {
  const properties = Object.fromEntries(
    Object.entries(node.properties).map(([name, child]) => [
      name,
      child.type === "object"
        ? stripEmptyRequired(child as MutableObjectNode)
        : child,
    ]),
  );
  return {
    type: "object",
    properties,
    ...(node.required.length > 0 ? { required: node.required } : {}),
    additionalProperties: false,
  };
}

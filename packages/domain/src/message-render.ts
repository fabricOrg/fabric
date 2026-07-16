import type { VariableSchema, VariableSchemaNode } from "@app/contracts";
import { type RateTable, rateSegments } from "./rating.js";
import { type Encoding, encodeAndSegment } from "./segmentation.js";

/**
 * Server-side SMS rendering + preview core (SDK-003 slice 3). PURE and DELIBERATELY NON-EXECUTABLE
 * (slice-0 §2 rendering contract): no code, no remote refs, bounded output. This is the single source
 * both public preview (slice 5) and managed send (SDK-005) consume, so a preview's rendered body,
 * encoding, segments, and cost equal a subsequent send on the same version + pricing.
 *
 * Field-level errors carry a JSON path and a stable code and NEVER the rejected value — a preview must
 * persist no PII, so nothing here echoes caller data into an error.
 */

// A rendered body can legitimately exceed the 1600-char content cap once variables expand; cap it so a
// pathological payload can't blow up segmentation/cost. Exceeding it is a blocker, not a silent clamp.
const MAX_RENDERED_CHARS = 6000;
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

const FORMAT_RE: Record<string, RegExp> = {
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  e164: /^\+[1-9]\d{6,14}$/,
  url: /^https?:\/\/[^\s]+$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

export interface RenderError {
  readonly path: string;
  readonly code: string;
}

export interface SmsPreview {
  readonly body: string;
  readonly encoding: Encoding;
  readonly length: number;
  readonly segments: number;
  readonly cost_minor: string;
  readonly currency: string;
}

export interface PreviewOutcome {
  /** Anything here blocks a send; when non-empty, `preview` is null and nothing was rendered/priced. */
  readonly blockers: readonly RenderError[];
  readonly preview: SmsPreview | null;
}

// ---- Payload validation against the variable-schema subset --------------------------------------
export function validatePayload(
  schema: VariableSchema,
  data: unknown,
): RenderError[] {
  const errors: RenderError[] = [];
  validateNode(schema, data, "", errors);
  return errors;
}

function validateNode(
  node: VariableSchemaNode,
  value: unknown,
  path: string,
  out: RenderError[],
): void {
  switch (node.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        out.push({ path, code: "expected_object" });
        return;
      }
      const obj = value as Record<string, unknown>;
      const required = new Set(node.required ?? []);
      for (const name of required) {
        if (!(name in obj))
          out.push({ path: join(path, name), code: "missing_required" });
      }
      for (const key of Object.keys(obj)) {
        if (!(key in node.properties)) {
          out.push({ path: join(path, key), code: "unexpected_property" });
        }
      }
      for (const [name, child] of Object.entries(node.properties)) {
        if (name in obj) validateNode(child, obj[name], join(path, name), out);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        out.push({ path, code: "expected_array" });
        return;
      }
      if (value.length > node.maxItems)
        out.push({ path, code: "too_many_items" });
      if (node.minItems !== undefined && value.length < node.minItems) {
        out.push({ path, code: "too_few_items" });
      }
      value.forEach((item, i) => {
        validateNode(node.items, item, join(path, i), out);
      });
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        out.push({ path, code: "expected_string" });
        return;
      }
      if (node.minLength !== undefined && value.length < node.minLength) {
        out.push({ path, code: "too_short" });
      }
      if (node.maxLength !== undefined && value.length > node.maxLength) {
        out.push({ path, code: "too_long" });
      }
      if (node.enum && !node.enum.includes(value)) {
        out.push({ path, code: "not_in_enum" });
      }
      if (node.format && !FORMAT_RE[node.format]?.test(value)) {
        out.push({ path, code: "invalid_format" });
      }
      return;
    }
    case "integer":
    case "number": {
      const okType =
        node.type === "integer"
          ? Number.isInteger(value)
          : typeof value === "number" && Number.isFinite(value);
      if (!okType) {
        out.push({ path, code: `expected_${node.type}` });
        return;
      }
      const n = value as number;
      if (node.minimum !== undefined && n < node.minimum) {
        out.push({ path, code: "below_minimum" });
      }
      if (node.maximum !== undefined && n > node.maximum) {
        out.push({ path, code: "above_maximum" });
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean")
        out.push({ path, code: "expected_boolean" });
      return;
    }
  }
}

// ---- Token declaration check + substitution -----------------------------------------------------
/** Distinct dotted token paths in a template body, e.g. "Hi {{name}}" -> ["name"]. */
export function extractTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TOKEN)) {
    if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

/** True if a dotted path resolves to a scalar (string/integer/number/boolean) declared in the schema. */
function pathIsDeclaredScalar(schema: VariableSchema, dotted: string): boolean {
  let node: VariableSchemaNode = schema;
  for (const seg of dotted.split(".")) {
    if (node.type !== "object") return false;
    const child: VariableSchemaNode | undefined = node.properties[seg];
    if (!child) return false;
    node = child;
  }
  return node.type !== "object" && node.type !== "array";
}

function resolve(data: unknown, dotted: string): unknown {
  let cur: unknown = data;
  for (const seg of dotted.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// ---- Preview assembly ---------------------------------------------------------------------------
export function previewSms(input: {
  template: string;
  schema: VariableSchema;
  data: unknown;
  currency: string;
  rates?: RateTable;
}): PreviewOutcome {
  const blockers: RenderError[] = [];

  // Every template token must be a declared scalar. An undeclared token is an authoring error, not a
  // silent blank (slice-0 §2). Reported at path = the token.
  for (const token of extractTokens(input.template)) {
    if (!pathIsDeclaredScalar(input.schema, token)) {
      blockers.push({ path: token, code: "unknown_token" });
    }
  }
  blockers.push(...validatePayload(input.schema, input.data));
  if (blockers.length > 0) return { blockers, preview: null };

  const body = input.template.replace(TOKEN, (_, key: string) => {
    const v = resolve(input.data, key);
    return v === undefined || v === null ? "" : String(v);
  });
  if (body.length > MAX_RENDERED_CHARS) {
    return {
      blockers: [{ path: "", code: "rendered_too_large" }],
      preview: null,
    };
  }

  const seg = encodeAndSegment(body);
  const cost = rateSegments(seg.segments, input.currency, input.rates);
  return {
    blockers: [],
    preview: {
      body,
      encoding: seg.encoding,
      length: seg.length,
      segments: seg.segments,
      cost_minor: cost.toString(),
      currency: input.currency,
    },
  };
}

function join(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

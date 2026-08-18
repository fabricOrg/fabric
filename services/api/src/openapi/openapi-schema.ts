import { type ZodType, z } from "zod";
import { componentNameFor } from "./schema-names.js";

/**
 * zod -> JSON Schema. The contracts in `@app/contracts` are the source of truth for every shape on
 * the wire, so the spec is DERIVED from them and a contract change cannot leave the docs behind.
 */

/** OpenAPI 3.1 is a JSON Schema 2020-12 superset, so that is the correct target — not `openapi-3.0`,
 * which downgrades unions to `nullable` and would lose precision the emitted 3.1 doc can carry. */
const TARGET = "draft-2020-12" as const;

/**
 * Types zod cannot represent, mapped to what this platform actually puts on the wire.
 *
 * `bigint` is the one that matters. Money is `bigint` minor units in the domain (never floats), but
 * it crosses the wire as an EXACT DECIMAL STRING — a JSON number would silently lose precision past
 * 2^53, which is the same class of defect a review already caught in the Paystack adapter. Emitting
 * `type: "integer"` here would document a lie that a generated client would then implement.
 */
function overrideUnrepresentable(ctx: {
  zodSchema: { _zod: { def: { type: string } } };
  jsonSchema: Record<string, unknown>;
}): void {
  const { type } = ctx.zodSchema._zod.def;
  if (type === "bigint") {
    ctx.jsonSchema.type = "string";
    ctx.jsonSchema.pattern = "^-?\\d+$";
    ctx.jsonSchema.description =
      "Exact integer in minor units, as a string. Never parse as a JSON number.";
    return;
  }
  if (type === "date") {
    ctx.jsonSchema.type = "string";
    ctx.jsonSchema.format = "date-time";
  }
}

/**
 * `io` is not a detail. Wherever a contract carries a transform, default or coercion, the input and
 * output shapes genuinely differ — a field with a default is OPTIONAL on the way in and GUARANTEED
 * on the way out. Documenting one direction with the other's schema tells callers to send values the
 * API rejects, or to expect fields that are never absent. A hand-written spec gets this wrong
 * invisibly; deriving it makes the distinction mechanical.
 */
export function toRequestSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema, "input");
}

export function toResponseSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema, "output");
}

function convert(
  schema: ZodType,
  io: "input" | "output",
): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: TARGET,
    io,
    // Repeats are INLINED, not lifted. `reused: "ref"` produced a `$defs` block local to each
    // converted schema and pointed at it with `#/$defs/…` — a fragment that resolves against the
    // DOCUMENT root, where no such block exists. 175 pointers in the public artifact dangled that
    // way, including the money field on `GET /v1/wallet`. Inlining costs bytes and removes the
    // failure mode entirely; it is also what the old comment here already claimed was happening.
    reused: "inline",
    // Cycles cannot be inlined by definition, so these are the only `$defs` that survive. Their
    // pointers are repaired in `schemaRef`.
    cycles: "ref",
    unrepresentable: "any",
    override: overrideUnrepresentable,
  }) as Record<string, unknown>;
  // zod stamps a `$schema` dialect on the ROOT of whatever it converts. Inside an OpenAPI Schema
  // Object that is noise at best — the document already declares its dialect once, at the top —
  // and some generators choke on it. Strip it from the root only; nested `$defs` never carry one.
  delete generated.$schema;
  return generated;
}

/**
 * Named contracts become `components.schemas` entries and are referenced; anything anonymous stays
 * inlined. That gives the reference a Models section a reader can actually browse, and shrinks the
 * document, without inventing names for schemas that have none.
 */
export function schemaRef(
  schema: ZodType,
  direction: "request" | "response",
  components: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const name = componentNameFor(schema);
  const rendered =
    direction === "request"
      ? toRequestSchema(schema)
      : toResponseSchema(schema);
  if (!name) {
    if (rendered.$defs)
      // Refuse rather than emit pointers that cannot resolve. An anonymous schema is inlined into
      // the operation, so its `$defs` have no addressable home — and a dangling `$ref` is exactly
      // the defect this repair exists to prevent.
      throw new Error(
        "An anonymous contract contains a cycle, so its `$defs` have nowhere addressable to live. " +
          "Export it from @app/contracts so it becomes a named component.",
      );
    return rendered;
  }
  // Request and response renderings of the SAME contract differ (io: input vs output), so they
  // cannot share one component. Suffixing keeps both honest rather than letting one overwrite.
  const key = direction === "request" ? `${name}Input` : name;
  // The surviving cycle `$defs` travel WITH the schema into `components.schemas.<key>`, so their
  // pointers must address them THERE. Left as `#/$defs/…` they resolve against the document root
  // and find nothing — which a byte-comparing `openapi:check` cannot see.
  repointDefs(rendered, `#/components/schemas/${key}`);
  if (!components.has(key)) components.set(key, rendered);
  return { $ref: `#/components/schemas/${key}` };
}

/** Rewrites every `#/$defs/X` beneath `node` to `<base>/$defs/X`, the defs' own refs included. */
function repointDefs(node: unknown, base: string): void {
  if (Array.isArray(node)) {
    for (const item of node) repointDefs(item, base);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const ref = record.$ref;
  if (typeof ref === "string" && ref.startsWith("#/$defs/"))
    record.$ref = `${base}/$defs/${ref.slice("#/$defs/".length)}`;
  for (const value of Object.values(record)) repointDefs(value, base);
}

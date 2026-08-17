import { type ZodType, z } from "zod";

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
  return z.toJSONSchema(schema, {
    target: TARGET,
    io,
    // Shapes are inlined per operation, with genuinely repeated sub-schemas lifted into a local
    // `$defs` block. The alternative — one shared `components.schemas` — needs a stable NAME per
    // contract, and zod schemas carry no name at runtime. Inlining trades artifact size for the
    // guarantee that no two operations can silently share a wrong definition.
    reused: "ref",
    cycles: "ref",
    unrepresentable: "any",
    override: overrideUnrepresentable,
  }) as Record<string, unknown>;
}

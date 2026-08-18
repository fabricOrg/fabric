import * as contracts from "@app/contracts";
import type { ZodType } from "zod";

/**
 * Names for the schemas the bindings reference, recovered from `@app/contracts`' own export names.
 *
 * The generator previously inlined every request and response, on the stated grounds that "zod
 * schemas carry no name at runtime". That is true of the schema OBJECT and false of the package:
 * `sendSmsRequest` is exported under that identifier, so iterating the module's exports and keying
 * by object identity recovers it exactly.
 *
 * It mattered more than artifact size. With everything inlined, `components.schemas` held only
 * `ErrorEnvelope`, so the reference's Models section — the part a QA engineer reads to learn the
 * shapes — was empty apart from an error wrapper.
 */

/** `sendSmsRequest` -> `SendSmsRequest`; `listApiKeysResponseSchema` -> `ListApiKeysResponse`. */
function toComponentName(exportName: string): string {
  const trimmed = exportName.replace(/Schema$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof (value as { safeParse: unknown }).safeParse === "function"
  );
}

/**
 * Identity-keyed, not structure-keyed. Two distinct contracts can be structurally identical today
 * and diverge tomorrow; collapsing them under one name would silently couple them.
 */
const NAMES: Map<ZodType, string> = (() => {
  const map = new Map<ZodType, string>();
  for (const [exportName, value] of Object.entries(contracts)) {
    if (!isZodSchema(value)) continue;
    // First export wins. A schema re-exported under an alias keeps its primary name rather than
    // whichever alias the iteration happened to reach last.
    if (!map.has(value)) map.set(value, toComponentName(exportName));
  }
  return map;
})();

/** The component name for a schema, or null when it is not an exported contract (an inline union,
 *  or an envelope built on the fly). Those stay inlined, which is correct — they have no identity
 *  a reader could look up. */
export function componentNameFor(schema: ZodType): string | null {
  return NAMES.get(schema) ?? null;
}

import type { VariableSchema, VariableSchemaNode } from "@app/contracts";

/**
 * Compatibility of an edited variable schema against the released one (SDK-003 slice-0 §3).
 * PURE: same function runs in the dashboard, the CLI, and the API — TypeScript generation alone never
 * proves safety because callers may run stale catalogs or other languages.
 *
 * A `compatible` candidate may publish a new immutable version under the SAME stable key. A `breaking`
 * candidate must use a new stable key (the API rejects a same-key breaking publish). Verdict is
 * `breaking` iff at least one breaking change is found; every breaking change is returned with its
 * JSON path so the UI can point at it.
 */

export type CompatibilityCode =
  | "type_changed"
  | "property_removed"
  | "required_property_added"
  | "made_required"
  | "constraint_narrowed"
  | "locale_removed"
  | "channel_removed";

export interface CompatibilityChange {
  readonly path: string;
  readonly code: CompatibilityCode;
}

export interface CompatibilityResult {
  readonly verdict: "compatible" | "breaking";
  readonly breaking: readonly CompatibilityChange[];
}

export function analyzeCompatibility(
  released: VariableSchema,
  candidate: VariableSchema,
): CompatibilityResult {
  const breaking: CompatibilityChange[] = [];
  compareNode(released, candidate, "", breaking);
  return {
    verdict: breaking.length === 0 ? "compatible" : "breaking",
    breaking,
  };
}

export function analyzeDefinitionCompatibility(
  released: VariableSchema,
  candidate: VariableSchema,
  releasedLocales: readonly string[],
  candidateLocales: readonly string[],
  releasedChannel: string,
  candidateChannel: string,
): CompatibilityResult {
  const schema = analyzeCompatibility(released, candidate);
  const candidateSet = new Set(candidateLocales);
  const removed = releasedLocales
    .filter((locale) => !candidateSet.has(locale))
    .map((locale) => ({
      path: `content.locales.${locale}`,
      code: "locale_removed" as const,
    }));
  // A released version is single-channel (ADR-0005 Amendment A1). Changing the channel removes the
  // released channel a stale caller may depend on — breaking, forcing a new stable key.
  const channelChange: CompatibilityChange[] =
    releasedChannel !== candidateChannel
      ? [{ path: "channel", code: "channel_removed" as const }]
      : [];
  const breaking = [...schema.breaking, ...removed, ...channelChange];
  return {
    verdict: breaking.length === 0 ? "compatible" : "breaking",
    breaking,
  };
}

function compareNode(
  prev: VariableSchemaNode,
  next: VariableSchemaNode,
  path: string,
  out: CompatibilityChange[],
): void {
  if (prev.type !== next.type) {
    out.push({ path, code: "type_changed" });
    return; // a type change is terminal for this node
  }
  if (prev.type === "string" && next.type === "string") {
    compareString(prev, next, path, out);
  } else if (
    (prev.type === "integer" && next.type === "integer") ||
    (prev.type === "number" && next.type === "number")
  ) {
    compareNumeric(prev, next, path, out);
  } else if (prev.type === "array" && next.type === "array") {
    if (
      narrowedMax(prev.maxItems, next.maxItems) ||
      raisedMin(prev.minItems, next.minItems)
    ) {
      out.push({ path, code: "constraint_narrowed" });
    }
    compareNode(prev.items, next.items, join(path, "items"), out);
  } else if (prev.type === "object" && next.type === "object") {
    compareObject(prev, next, path, out);
  }
}

function compareString(
  prev: Extract<VariableSchemaNode, { type: "string" }>,
  next: Extract<VariableSchemaNode, { type: "string" }>,
  path: string,
  out: CompatibilityChange[],
): void {
  // Longer minimum, shorter maximum, a newly-added bound, a shrunk/added enum, or an added/changed
  // format all RESTRICT the accepted input -> breaking. The mirror (relaxing) is compatible.
  if (
    raisedMin(prev.minLength, next.minLength) ||
    narrowedMax(prev.maxLength, next.maxLength)
  ) {
    out.push({ path, code: "constraint_narrowed" });
    return;
  }
  if (
    enumNarrowed(prev.enum, next.enum) ||
    formatNarrowed(prev.format, next.format)
  ) {
    out.push({ path, code: "constraint_narrowed" });
  }
}

function compareNumeric(
  prev: Extract<VariableSchemaNode, { type: "integer" | "number" }>,
  next: Extract<VariableSchemaNode, { type: "integer" | "number" }>,
  path: string,
  out: CompatibilityChange[],
): void {
  if (
    raisedMin(prev.minimum, next.minimum) ||
    narrowedMax(prev.maximum, next.maximum)
  ) {
    out.push({ path, code: "constraint_narrowed" });
  }
}

function compareObject(
  prev: Extract<VariableSchemaNode, { type: "object" }>,
  next: Extract<VariableSchemaNode, { type: "object" }>,
  path: string,
  out: CompatibilityChange[],
): void {
  const prevRequired = new Set(prev.required ?? []);
  const nextRequired = new Set(next.required ?? []);

  for (const name of Object.keys(prev.properties)) {
    if (!(name in next.properties)) {
      // Remove and rename are indistinguishable at the schema level; both are breaking.
      out.push({ path: join(path, name), code: "property_removed" });
    }
  }
  for (const [name, nextChild] of Object.entries(next.properties)) {
    const p = join(path, name);
    const prevChild = prev.properties[name];
    if (!prevChild) {
      // A newly-added property is breaking only if required; an optional addition is compatible.
      if (nextRequired.has(name)) {
        out.push({ path: p, code: "required_property_added" });
      }
      continue;
    }
    // Optional -> required tightens the contract; required -> optional relaxes it (compatible).
    if (!prevRequired.has(name) && nextRequired.has(name)) {
      out.push({ path: p, code: "made_required" });
    }
    compareNode(prevChild, nextChild, p, out);
  }
}

// A bound is "raised" (min) or "narrowed" (max) when it exists in `next` and is strictly tighter than
// `prev`, OR when `next` introduces a bound that `prev` did not have (undefined = unbounded).
function raisedMin(
  prev: number | undefined,
  next: number | undefined,
): boolean {
  if (next === undefined) return false;
  if (prev === undefined) return true;
  return next > prev;
}
function narrowedMax(
  prev: number | undefined,
  next: number | undefined,
): boolean {
  if (next === undefined) return false;
  if (prev === undefined) return true;
  return next < prev;
}
function enumNarrowed(
  prev: readonly string[] | undefined,
  next: readonly string[] | undefined,
): boolean {
  if (next === undefined) return false; // dropping the enum widens acceptance
  if (prev === undefined) return true; // adding an enum restricts to a fixed set
  // Narrowed iff a value the released schema accepted is no longer allowed (prev ⊄ next). Adding new
  // members (next a superset) only widens, so it is compatible.
  const nextSet = new Set(next);
  return prev.some((v) => !nextSet.has(v));
}
function formatNarrowed(
  prev: string | undefined,
  next: string | undefined,
): boolean {
  if (next === undefined) return false; // removing a format widens
  return next !== prev; // adding or changing a format restricts
}

function join(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

import { z } from "zod";

/**
 * Reading a Meta template's COMPONENTS: how many body parameters it takes, and what its body says.
 *
 * Pure, and separate from the service, because the shape is Meta's and the interesting cases are all
 * about their data rather than ours — a template with no body, a body with no placeholders, gaps or
 * repeats in the numbering, components we do not model.
 *
 * Why the count matters: Meta rejects a send whose parameter count differs from the template's, and
 * that rejection lands AFTER the wallet reserve. Showing the count is how a caller stops guessing.
 */

const component = z.object({
  type: z.string().trim().min(1).optional(),
  text: z.string().optional(),
});
const components = z.array(component);

/** `{{1}}`, `{{2}}` … Meta's body placeholders are POSITIONAL and carry no names. */
const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

export interface TemplateShape {
  readonly variableCount: number;
  readonly bodyPreview: string | null;
}

export function templateShape(raw: unknown): TemplateShape {
  const parsed = components.safeParse(raw);
  if (!parsed.success) return { variableCount: 0, bodyPreview: null };
  // Meta uppercases component types, but tolerate either — this is their payload, not ours.
  const body = parsed.data.find((c) => (c.type ?? "").toUpperCase() === "BODY");
  const text = typeof body?.text === "string" ? body.text : null;
  if (!text) return { variableCount: 0, bodyPreview: null };
  return { variableCount: countPlaceholders(text), bodyPreview: text };
}

/**
 * The count is the HIGHEST index, not the number of distinct placeholders.
 *
 * A body may repeat `{{1}}` and may — through an author's edit — skip a number. Meta expects a
 * parameter array long enough to satisfy the largest index it sees, so counting distinct tokens would
 * under-supply on a gap and a send would fail at the provider for a reason nobody could see from here.
 */
function countPlaceholders(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > highest) highest = index;
  }
  return highest;
}

/**
 * Every `$ref` in the emitted document must resolve against the document itself.
 *
 * This gate exists because nothing else could see the failure. `openapi:check` byte-compares the
 * committed artifact against a fresh build, so a document that is *consistently* broken passes
 * forever; `assertCoverage` checks routes, not schemas; the unit tests assert on the parts they
 * name. 175 pointers in the published customer artifact resolved to nothing — zod emits `$defs`
 * local to each converted schema and addresses them with `#/$defs/…`, which is a fragment against
 * the DOCUMENT root — and among them was the money field on `GET /v1/wallet`, so a client generated
 * from the SDK tarball got no type at all for `balance`.
 *
 * A structural check is the only kind that catches this class: the document was valid JSON, matched
 * its own generator, and was wrong.
 */

export class UnresolvedRefError extends Error {}

/** JSON Pointer resolution, per RFC 6901 — `~1` is `/` and `~0` is `~`, in that order. */
function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === "#") return document;
  if (!pointer.startsWith("#/")) return undefined;
  let node: unknown = document;
  for (const raw of pointer.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
    if (node === undefined) return undefined;
  }
  return node;
}

export function assertRefsResolve(document: Record<string, unknown>): void {
  const dangling: string[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, `${path}/${index}`);
      });
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const ref = record.$ref;
    if (typeof ref === "string" && resolvePointer(document, ref) === undefined)
      dangling.push(`  ${path || "/"}  ->  ${ref}`);
    for (const [key, value] of Object.entries(record))
      walk(value, `${path}/${key}`);
  };

  walk(document, "");
  if (dangling.length === 0) return;
  throw new UnresolvedRefError(
    `${dangling.length} $ref(s) do not resolve against the document:\n${dangling
      .slice(0, 20)
      .join(
        "\n",
      )}${dangling.length > 20 ? `\n  … and ${dangling.length - 20} more` : ""}`,
  );
}

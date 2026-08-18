import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RequestMethod } from "@nestjs/common";

/**
 * THE ROUTE TABLE, read from the controllers' own decorator metadata.
 *
 * Deliberately does NOT boot a Nest container. The first cut used `DiscoveryService`, which meant
 * `NestFactory.createApplicationContext(AppModule)` — and that instantiates every provider, so
 * generating a document opened database and Redis connections and then hung on a retry loop. A spec
 * generator that needs a live datastore is a spec generator nobody runs in CI.
 *
 * Importing a controller module evaluates it but instantiates nothing: constructor dependencies and
 * `useFactory` providers never run, so no connection is attempted. The decorator metadata this reads
 * is attached at class-definition time, which is all that is required.
 */

export interface DiscoveredRoute {
  readonly method: string;
  readonly path: string;
  readonly controller: string;
  readonly handler: string;
}

/**
 * Nest's metadata keys. Declared rather than imported from `@nestjs/common/constants`, a deep
 * subpath the package does not export (NodeNext rejects it). Stable Nest internals; if a major
 * upgrade changed them, every route would go missing at once and `assertCoverage` fails loudly —
 * which is the correct way for this to break rather than emitting a silently empty document.
 */
const PATH_METADATA = "path";
const METHOD_METADATA = "method";

const METHOD_NAMES: Readonly<Record<number, string>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
};

export function routeKey(route: { method: string; path: string }): string {
  return `${route.method} ${route.path}`;
}

function joinPath(prefix: unknown, suffix: unknown): string {
  const head = typeof prefix === "string" ? prefix : "";
  const tail = typeof suffix === "string" ? suffix : "";
  const segments = `${head}/${tail}`
    .split("/")
    .filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

async function controllerFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await controllerFiles(full)));
      continue;
    }
    // `.controller.ts` only, and never a spec — a test double carrying @Controller would otherwise
    // contribute phantom routes that no deployed server serves.
    if (entry.name.endsWith(".controller.ts") && !entry.name.includes(".spec."))
      found.push(full);
  }
  return found;
}

function routesFromClass(target: unknown, name: string): DiscoveredRoute[] {
  if (typeof target !== "function") return [];
  const controllerPath = Reflect.getMetadata(PATH_METADATA, target);
  if (controllerPath === undefined) return [];

  const routes: DiscoveredRoute[] = [];
  const prototype = (target as { prototype?: object }).prototype;
  if (!prototype) return [];

  for (const handler of Object.getOwnPropertyNames(prototype)) {
    if (handler === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, handler);
    if (typeof descriptor?.value !== "function") continue;
    const verb = Reflect.getMetadata(METHOD_METADATA, descriptor.value);
    if (typeof verb !== "number") continue;
    const verbName = METHOD_NAMES[verb];
    if (!verbName) {
      // @All() or an unmapped verb. Refuse rather than guess: a handler answering every method is a
      // security-relevant surprise, and documenting it as GET would hide exactly that.
      throw new Error(
        `${name}.${handler} uses an unsupported request method (${verb}). ` +
          "Replace @All() with the verbs it actually serves.",
      );
    }
    const handlerPath = Reflect.getMetadata(PATH_METADATA, descriptor.value);
    if (Array.isArray(handlerPath) || Array.isArray(controllerPath)) {
      // Nest accepts `@Get(["", "/z"])`. `joinPath` silently rendered a non-string as "", so the
      // FIRST alias was documented and the rest became live, unbound, unvalidated routes that
      // `assertCoverage` could not see — `GET /health/z` shipped exactly that way. Refuse, for the
      // same reason @All() is refused: a route the generator cannot see is the failure this
      // pipeline exists to prevent, and silence is how it recurs.
      throw new Error(
        `${name}.${handler} declares an array of paths. Give each path its own handler so every ` +
          "route is discoverable, bound, and validated.",
      );
    }
    routes.push({
      method: verbName,
      path: joinPath(controllerPath, handlerPath),
      controller: name,
      handler,
    });
  }
  return routes;
}

/** Sorted for a stable diff — the artifact is committed and byte-compared, so ordering must not
 * depend on filesystem traversal order. */
export async function collectRoutes(
  sourceRoot: string,
): Promise<DiscoveredRoute[]> {
  const routes: DiscoveredRoute[] = [];
  for (const file of await controllerFiles(resolve(sourceRoot))) {
    const module: Record<string, unknown> = await import(
      pathToFileURL(file).href
    );
    for (const [name, exported] of Object.entries(module)) {
      routes.push(...routesFromClass(exported, name));
    }
  }
  return routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BindingCoverageError,
  buildOpenApiDocument,
} from "../src/openapi/openapi-document.js";
import { ROUTE_BINDINGS } from "../src/openapi/route-bindings.js";
import { collectRoutes } from "../src/openapi/route-table.js";

/**
 * Emits both OpenAPI artifacts, or (with --check) fails when the committed copies are stale.
 *
 * --check is the gate that matters. Generation alone is a convenience; the check is what stops a new
 * endpoint reaching `dev` undocumented — which is exactly how the previous artifact lost the entire
 * WhatsApp channel while every pipeline stayed green.
 *
 * NOTHING IS BOOTED. Routes come from the controllers' decorator metadata and schemas from the zod
 * contracts, so this runs with no database, no Redis and no environment at all. An earlier cut used
 * a Nest application context and hung on provider construction; requiring live infrastructure to
 * describe an API is how a documentation gate quietly stops being run.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, "../src");
const ROOT = resolve(HERE, "../../..");
const PUBLIC_PATH = resolve(ROOT, "docs/api/openapi.json");
const FULL_PATH = resolve(ROOT, "docs/api/openapi.internal.json");
/**
 * The SDK package publishes the public document as part of its tarball (`files` + `exports` in its
 * package.json), so it gets the SAME bytes rather than its own generator. It previously had one,
 * describing paths and schemas by hand into this very path — two writers, one file, and the
 * hand-written one is how the spec ended up with a dead host and no WhatsApp.
 */
const SDK_PUBLIC_PATH = resolve(ROOT, "packages/sdk/openapi.json");

const SERVER_URL =
  process.env.API_PUBLIC_BASE_URL ??
  process.env.API_BASE_URL ??
  "http://localhost:3000";

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const routes = await collectRoutes(API_SRC);

  const publicDocument = buildOpenApiDocument(routes, ROUTE_BINDINGS, {
    include: ["public"],
    serverUrl: SERVER_URL,
    title: "Fabric API",
    description:
      "Server-to-server messaging API. Secret keys must never be used in browsers.",
    version: "1.0.0",
  });

  const artifacts = [
    { path: PUBLIC_PATH, document: publicDocument },
    { path: SDK_PUBLIC_PATH, document: publicDocument },
    {
      path: FULL_PATH,
      document: buildOpenApiDocument(routes, ROUTE_BINDINGS, {
        include: ["public", "internal", "webhook"],
        serverUrl: SERVER_URL,
        title: "Fabric API — internal",
        description:
          "Complete surface, including BFF and staff control-plane routes. Not for distribution.",
        version: "1.0.0",
      }),
    },
  ];

  let stale = false;
  for (const { path, document } of artifacts) {
    const serialised = `${JSON.stringify(document, null, 2)}\n`;
    if (check) {
      if ((await readFile(path, "utf8").catch(() => null)) !== serialised) {
        stale = true;
        console.error(
          `STALE: ${path}\n  Run: pnpm --filter @app/api openapi:generate`,
        );
      }
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialised, "utf8");
    console.log(`wrote ${path}`);
  }
  if (stale) process.exitCode = 1;
  else if (!check) console.log(`${routes.length} routes bound.`);
}

try {
  await main();
} catch (error) {
  if (error instanceof BindingCoverageError) {
    // Printed alone — a stack trace would bury the list of routes that need attention.
    console.error(`\nOpenAPI bindings are out of sync:\n\n${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}

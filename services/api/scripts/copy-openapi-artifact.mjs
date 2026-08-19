import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy the committed OpenAPI artifact into `dist/`, as part of the api build.
 *
 * WHY THIS EXISTS. `OpenApiService` finds the artifact by walking up from its own module location to
 * the repo root, which works when the repo IS the deployment and not otherwise. A pruned package —
 * `pnpm --filter @app/api deploy --prod`, which is how the container image is built — has no repo
 * above it. `dist/` is the one directory that is, by definition, part of this package wherever it is
 * shipped, so putting the artifact there makes the lookup independent of the packaging strategy
 * rather than adding a special case per platform.
 *
 * The prompt for it was a deployed `GET /docs/openapi.json` answering
 * `503 openapi_artifact_missing` while every gate, every test and the deploy pipeline stayed green —
 * all of them run where the repo exists. Which mechanism made the artifact unreachable THERE is not
 * established; this removes a class of them rather than a diagnosed instance.
 *
 * FAILS THE BUILD if the artifact is absent. A missing document is not something to discover at
 * runtime in a container — `openapi:generate` writes it and `openapi:check` proves it is current, so
 * by build time it must exist.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../../docs/api/openapi.internal.json");
const TARGET = resolve(HERE, "../dist/openapi.internal.json");

try {
  await mkdir(dirname(TARGET), { recursive: true });
  await copyFile(SOURCE, TARGET);
} catch {
  // Say the remedy, not the syscall. A raw ENOENT stack from an .mjs file most people do not know
  // exists, at the tail of a `tsc` run, is a poor way to learn that one command fixes it — the
  // runtime 503 for the same condition already names that command.
  console.error(
    `The OpenAPI artifact is missing: ${SOURCE}
Run: pnpm --filter @app/api openapi:generate`,
  );
  process.exit(1);
}
console.log(`openapi artifact -> ${TARGET}`);

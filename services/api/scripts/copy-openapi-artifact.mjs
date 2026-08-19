import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy the committed OpenAPI artifact into `dist/`, as part of the api build.
 *
 * WHY THIS EXISTS. `OpenApiService` finds the artifact by walking up from its own module location to
 * the repo root, which is correct when the repo IS the deployment. The container is not: the image
 * is built with `pnpm --filter @app/api deploy --prod --legacy /runtime`, which packages the api
 * package alone, so repo-root `docs/api/` never enters it. On the deployed environment
 * `GET /docs/openapi.json` therefore answered
 *
 *   503 {"error":{"code":"openapi_artifact_missing", ...}}
 *
 * and the reference page rendered an empty shell — with every gate, every test and the deploy
 * pipeline green, because all of them ran where the repo exists.
 *
 * `dist/` is the one directory that is, by definition, part of the package wherever it is shipped.
 * Putting the artifact there makes the lookup independent of how the app was packaged.
 *
 * FAILS THE BUILD if the artifact is absent. A missing document is not something to discover at
 * runtime in a container — `openapi:generate` writes it and `openapi:check` proves it is current, so
 * by build time it must exist.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../../docs/api/openapi.internal.json");
const TARGET = resolve(HERE, "../dist/openapi.internal.json");

await mkdir(dirname(TARGET), { recursive: true });
await copyFile(SOURCE, TARGET);
console.log(`openapi artifact -> ${TARGET}`);

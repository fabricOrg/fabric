import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { apiError } from "../http/api-error.js";

/**
 * Serves the COMMITTED specification rather than rebuilding one per request.
 *
 * Two reasons, and the second is the important one:
 *  1. Building needs the controller modules re-imported and every contract re-serialised — real
 *     work to repeat on an endpoint a handful of operators open.
 *  2. What an operator reads is then, by construction, the exact artifact CI byte-compared. A
 *     runtime rebuild could disagree with the committed file and nothing would notice — which is
 *     precisely the "second source of truth" failure this whole pipeline replaced.
 *
 * The artifact is produced by `scripts/generate-openapi.ts` and its freshness is enforced by
 * `openapi:check`.
 */
@Injectable()
export class OpenApiService {
  private cached: Record<string, unknown> | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async fullDocument(): Promise<Record<string, unknown>> {
    if (this.cached) return this.cached;
    const raw = await this.readArtifact();
    if (raw === null) {
      // Explicit and actionable, never an empty document. A blank spec would read as "this API has
      // no endpoints", which is a far more confusing thing to hand an operator than an error.
      throw apiError({
        type: "api_error",
        code: "openapi_artifact_missing",
        message:
          "The OpenAPI artifact has not been generated. Run: pnpm --filter @app/api openapi:generate",
        status: 503,
      });
    }
    this.cached = JSON.parse(raw) as Record<string, unknown>;
    return this.cached;
  }

  /**
   * Find the artifact without assuming a working directory.
   *
   * A cwd-relative default looked fine and was wrong: the API is started from `services/api`, so
   * `docs/api/…` resolved under the package rather than the repo, and the endpoint reported the
   * artifact missing while it sat committed two directories up. Walking up from THIS module's own
   * location is stable whether the process runs from the repo root, from `services/api`, from
   * `dist/`, or under a process manager that sets its own cwd.
   */
  private async readArtifact(): Promise<string | null> {
    const configured = this.config.get<string>("OPENAPI_INTERNAL_PATH");
    if (configured)
      return readFile(resolve(configured), "utf8").catch(() => null);

    let dir = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = resolve(dir, "docs/api/openapi.internal.json");
      const raw = await readFile(candidate, "utf8").catch(() => null);
      if (raw !== null) return raw;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }
}

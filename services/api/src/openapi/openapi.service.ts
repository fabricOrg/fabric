import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
    const path = resolve(
      this.config.get<string>("OPENAPI_INTERNAL_PATH") ??
        "docs/api/openapi.internal.json",
    );
    const raw = await readFile(path, "utf8").catch(() => null);
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
}

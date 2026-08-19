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

  /** The artifact exactly as committed. Hermetic — the server url is still the `{baseUrl}` template. */
  async fullDocument(): Promise<Record<string, unknown>> {
    if (this.cached) return this.cached;
    const raw = await this.readArtifact();
    if (raw === null) {
      // Explicit and actionable, never an empty document. A blank spec would read as "this API has
      // no endpoints", which is a far more confusing thing to hand an operator than an error.
      // Name the override when one is set. "Not generated" and "your OPENAPI_INTERNAL_PATH points at
      // nothing" are different problems with the same symptom, and an operator reading only the
      // first will regenerate a file the process was never going to look at.
      const configured = this.config.get<string>("OPENAPI_INTERNAL_PATH");
      throw apiError({
        type: "api_error",
        code: "openapi_artifact_missing",
        message: configured
          ? `OPENAPI_INTERNAL_PATH is set to "${configured}" and could not be read. Point it at a generated artifact, or unset it to use the copy that ships with the build.`
          : "The OpenAPI artifact has not been generated. Run: pnpm --filter @app/api openapi:generate",
        status: 503,
      });
    }
    this.cached = JSON.parse(raw) as Record<string, unknown>;
    return this.cached;
  }

  /**
   * The document as the DOCS PAGE should see it: same content, but pointed at the deployment it was
   * served from.
   *
   * The committed artifact deliberately carries a `{baseUrl}` template defaulting to
   * `http://localhost:3000` — right for a file in git, wrong for a page a tester is about to click
   * "Test Request" on. Left alone, every trial request from the deployed docs fires at the TESTER'S
   * OWN machine and fails in a way that reads as "the API is broken".
   *
   * Resolved from configuration, never from the request. Behind Render's proxy — as behind API
   * Gateway + VPC Link — the container sees its internal host, so `Host`/`x-forwarded-*` are not a
   * trustworthy source for a url handed to a caller. Same lesson as the auth redirects.
   * `RENDER_EXTERNAL_URL` is injected by the platform, so testing needs no extra secret; set
   * `PUBLIC_API_BASE_URL` to override anywhere else. With neither, the template is left untouched
   * rather than guessed at.
   */
  async servedDocument(): Promise<Record<string, unknown>> {
    const document = await this.fullDocument();
    const baseUrl = this.publicBaseUrl();
    if (!baseUrl) return document;
    // Shallow copy: the cached artifact stays byte-identical to the committed file, so nothing that
    // reads it later is looking at a mutated singleton.
    return {
      ...document,
      servers: [{ url: baseUrl, description: "This deployment." }],
    };
  }

  private publicBaseUrl(): string | null {
    const configured =
      this.config.get<string>("PUBLIC_API_BASE_URL") ??
      this.config.get<string>("RENDER_EXTERNAL_URL");
    const trimmed = configured?.trim().replace(/\/+$/, "");
    return trimmed ? trimmed : null;
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

    // REPO LAYOUT FIRST. In a checkout this is the file `openapi:generate` just wrote and
    // `openapi:check` just proved current, so it must outrank a `dist/` copy that a build may have
    // produced earlier — otherwise `pnpm start` after a regenerate serves the previous document with
    // no signal that it is stale. In a packaged deployment there is no repo above the module, so
    // these eight `stat`s miss and cost nothing; the result is cached either way.
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = resolve(dir, "docs/api/openapi.internal.json");
      const raw = await readFile(candidate, "utf8").catch(() => null);
      if (raw !== null) return raw;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // THEN THE COPY THAT SHIPS WITH THE PACKAGE. The api build writes the artifact into `dist/`,
    // which is the one directory that travels with this package under EVERY packaging strategy — a
    // pruned `pnpm deploy` image, a platform-native build, a tarball. That is the point: the lookup
    // stops depending on how the app was shipped, rather than growing a special case per platform.
    //
    // Deliberately not a claim about why the deployed environment answered 503
    // `openapi_artifact_missing`. That happened, and it means the artifact was not findable there;
    // which of the plausible mechanisms it was has not been established, and a comment is the wrong
    // place to record a guess as a cause.
    const packaged = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../openapi.internal.json",
    );
    const shipped = await readFile(packaged, "utf8").catch(() => null);
    if (shipped !== null) return shipped;
    return null;
  }
}

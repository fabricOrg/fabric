import type { AppDb } from "@app/db";
import { Controller, Get, Inject } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { apiError } from "../http/api-error.js";

/**
 * Liveness is dependency-free so a database outage does not cause container restart loops.
 * Readiness probes app_runtime separately and returns 503 while the task should receive no traffic.
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  // `@Get(["", "/z"])` here served `/health/z`, not `/healthz` — the alias it was meant to add
  // never existed, nothing ever called it, and being array-form it was invisible to the OpenAPI
  // generator. Removed rather than documented. (breaking, pre-prod, §11)
  @Get()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("/readyz")
  async ready(): Promise<{ status: "ok"; db: "up" }> {
    try {
      const rows = await this.db.sql<{ ok: number }[]>`SELECT 1 AS ok`;
      if (rows[0]?.ok !== 1) throw new Error("database probe returned no row");
      return { status: "ok", db: "up" };
    } catch {
      // `apiError`, not `ServiceUnavailableException`. With no global exception filter, Nest
      // serialises an exception's payload verbatim — so the old `{ status, db }` object went out as
      // a 503 in a shape the document does not publish and that carries no `error.code` to branch
      // on. The one response this endpoint gives when something is actually WRONG was the one
      // nobody could parse, on the endpoint the deploy pipeline polls.
      throw apiError({
        type: "api_error",
        code: "not_ready",
        message:
          "The database is not reachable, so this instance should receive no traffic.",
        status: 503,
      });
    }
  }
}

import type { AppDb } from "@app/db";
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";

/**
 * Liveness is dependency-free so a database outage does not cause container restart loops.
 * Readiness probes app_runtime separately and returns 503 while the task should receive no traffic.
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  @Get(["", "/z"])
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
      throw new ServiceUnavailableException({
        status: "unavailable",
        db: "down",
      });
    }
  }
}

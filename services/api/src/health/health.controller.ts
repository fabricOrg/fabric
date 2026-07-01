import type { AppDb } from "@app/db";
import { Controller, Get, Inject } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";

/**
 * GET /health — liveness + DB reachability. Uses the raw app_runtime pool (no tenant context needed
 * for a bare `SELECT 1`). Returns 200 with a small JSON body; a failing DB throws → 500.
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  @Get()
  async check(): Promise<{ status: "ok"; db: "up" | "down" }> {
    const rows = await this.db.sql<{ ok: number }[]>`SELECT 1 AS ok`;
    return { status: "ok", db: rows[0]?.ok === 1 ? "up" : "down" };
  }
}

import { createHash } from "node:crypto";
import type {
  CreateOptOutRequest,
  MessageClass,
  OptOutDto,
} from "@app/contracts";
import { type AppDb, optOuts } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";

/**
 * Consent / opt-out registry (E10-S5, NCC 2442). Scope semantics are the whole point:
 * "promotional" = DND — promo blocked, TRANSACTIONAL STILL FLOWS (NCC: OTP/receipts bypass the
 * registry 24/7); "all" = the customer's own full-suppression list — everything blocked.
 */
@Injectable()
export class ConsentService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async list(tenantId: string): Promise<OptOutDto[]> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select()
        .from(optOuts)
        .where(eq(optOuts.tenantId, tenantId as never))
        .orderBy(desc(optOuts.createdAt)),
    );
    return rows.map(toDto);
  }

  async add(
    tenantId: string,
    request: CreateOptOutRequest,
    source: "stop" | "registry" | "manual" = "manual",
  ): Promise<OptOutDto> {
    const [row] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .insert(optOuts)
        .values({
          tenantId: tenantId as never,
          msisdnHash: sha256(request.msisdn),
          msisdnMasked: maskMsisdn(request.msisdn),
          scope: request.scope,
          source,
        })
        // Re-adding a number updates its scope in place (e.g. promotional → all).
        .onConflictDoUpdate({
          target: [optOuts.tenantId, optOuts.msisdnHash],
          set: { scope: request.scope, source, updatedAt: new Date() },
        })
        .returning(),
    );
    if (!row) throw new Error("Opt-out upsert returned no row.");
    return toDto(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const deleted = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .delete(optOuts)
        .where(and(eq(optOuts.id, id), eq(optOuts.tenantId, tenantId as never)))
        .returning({ id: optOuts.id }),
    );
    if (deleted.length === 0) {
      throw notFound("opt_out_not_found", "No opt-out with that id.");
    }
  }

  /** Send-path gate: is this recipient suppressed for the given traffic class? */
  async isSuppressed(
    tenantId: string,
    to: string,
    messageClass: MessageClass,
  ): Promise<boolean> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({ scope: optOuts.scope })
        .from(optOuts)
        .where(
          and(
            eq(optOuts.tenantId, tenantId as never),
            eq(optOuts.msisdnHash, sha256(to)),
          ),
        )
        .limit(1),
    );
    const scope = rows[0]?.scope;
    if (!scope) return false;
    if (scope === "all") return true;
    // scope === "promotional": DND blocks promo only — transactional bypasses (NCC 2442).
    return messageClass === "promotional";
  }
}

/**
 * Promotional window (E10-S5/S6). Per-country, strictest-reading posture until primary texts
 * are fully verified (docs/PI-4/GHANA-NCA-FINDINGS.md):
 *   NG (NCC 2442): 08:00–20:00 WAT (UTC+1), any day.
 *   GH (NCA UEC):  08:00–19:00 local (UTC+0), and NO promotional SMS on Sundays.
 * Pure function — the clock is a parameter so tests own time.
 */
export function promoWindowOpen(now: Date, country: string): boolean {
  if (country === "NG") {
    const watHour = (now.getUTCHours() + 1) % 24;
    return watHour >= 8 && watHour < 20;
  }
  // GH is UTC+0 — UTC day-of-week/hour ARE local.
  if (now.getUTCDay() === 0) return false; // Sunday
  const hour = now.getUTCHours();
  return hour >= 8 && hour < 19;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function maskMsisdn(to: string): string {
  if (to.length <= 9) return `${to.slice(0, 3)}•••`;
  return `${to.slice(0, 6)}•••${to.slice(-4)}`;
}

function toDto(row: typeof optOuts.$inferSelect): OptOutDto {
  return {
    id: row.id,
    msisdn: row.msisdnMasked,
    scope: row.scope,
    source: row.source,
    created_at: row.createdAt.toISOString(),
  };
}

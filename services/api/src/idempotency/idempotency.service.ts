import { createHash } from "node:crypto";
import { type AppDb, apiIdempotencyKeys, type TenantId } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { apiError, invalidRequest } from "../http/api-error.js";

/**
 * CLIENT IDEMPOTENCY (ARCHITECTURE §7, remediation finding 3) — honors the `Idempotency-Key`
 * header on money POSTs. The engine's internal keys (`reserve:{messageId}`) only protect internal
 * retries; without THIS layer a client retry of POST /v1/sms/send mints a new message + new
 * reservation = double charge.
 *
 * Contract (Stripe semantics):
 *   - first request with a key: runs normally; the success response is stored against the key.
 *   - retry, same key + same body: replays the stored response — NO second side effect.
 *   - same key + different body: 409 `idempotency_key_reused` (the client is misusing the key).
 *   - same key while the first is still running: 409 `idempotency_in_flight` (retry shortly).
 *   - a request that FAILS releases its key, so the client may retry with the same key.
 *
 * Storage is tenant-scoped under RLS (0030): UNIQUE(tenant_id, key) arbitrates the race — two
 * concurrent same-key requests both INSERT .. ON CONFLICT DO NOTHING; exactly one wins. Keys
 * expire after IDEMPOTENCY_TTL_HOURS (the maintenance job purges them) — a replay window, not an
 * archive.
 */

const TTL_HOURS = 24;
const MAX_KEY_LENGTH = 255;

export type IdempotencyBegin =
  | { kind: "new" }
  | { kind: "replay"; response: unknown };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  /** Canonical body fingerprint — proves "same key, same request" on replay. */
  fingerprint(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(body)).digest("hex");
  }

  /**
   * Claim the key (or resolve what happened to it). Call BEFORE the side effect.
   * Throws the 409s; returns `replay` with the stored response, or `new` when this request won.
   */
  async begin(
    tenantId: string,
    key: string,
    fingerprint: string,
  ): Promise<IdempotencyBegin> {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw invalidRequest(
        "invalid_idempotency_key",
        `\`Idempotency-Key\` must be 1-${MAX_KEY_LENGTH} characters.`,
      );
    }
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const inserted = await tx
        .insert(apiIdempotencyKeys)
        .values({
          tenantId: tenantId as TenantId,
          key,
          fingerprint,
          expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
        })
        .onConflictDoNothing()
        .returning({ id: apiIdempotencyKeys.id });
      if (inserted.length > 0) return { kind: "new" } as const;

      // Lost the race (or a genuine retry): read the winner's row.
      const [existing] = await tx
        .select()
        .from(apiIdempotencyKeys)
        .where(
          and(
            eq(apiIdempotencyKeys.tenantId, tenantId as TenantId),
            eq(apiIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      if (!existing) {
        // Row vanished between conflict and read (purged/released) — tell the client to retry.
        throw inFlight();
      }
      if (existing.fingerprint !== fingerprint) {
        throw apiError({
          type: "idempotency_error",
          code: "idempotency_key_reused",
          message:
            "This Idempotency-Key was already used with a different request body.",
          status: 409,
        });
      }
      if (existing.status !== "completed") {
        throw inFlight();
      }
      return { kind: "replay", response: existing.response } as const;
    });
  }

  /** Store the success response against the key. Call AFTER the side effect succeeds. */
  async complete(
    tenantId: string,
    key: string,
    response: unknown,
  ): Promise<void> {
    await this.db.withTenantDrizzle(tenantId, async (tx) => {
      await tx
        .update(apiIdempotencyKeys)
        .set({ status: "completed", response, updatedAt: new Date() })
        .where(
          and(
            eq(apiIdempotencyKeys.tenantId, tenantId as TenantId),
            eq(apiIdempotencyKeys.key, key),
          ),
        );
    });
  }

  /**
   * Release the key after a FAILED request (the stored row is `pending` and useless — the client
   * must be allowed to retry the same key). Never throws: releasing is best-effort; an orphaned
   * pending row expires via TTL anyway.
   */
  async release(tenantId: string, key: string): Promise<void> {
    try {
      await this.db.withTenantDrizzle(tenantId, async (tx) => {
        await tx
          .delete(apiIdempotencyKeys)
          .where(
            and(
              eq(apiIdempotencyKeys.tenantId, tenantId as TenantId),
              eq(apiIdempotencyKeys.key, key),
              eq(apiIdempotencyKeys.status, "pending"),
            ),
          );
      });
    } catch {
      // Swallow: the original error is what the client must see; TTL cleans up.
    }
  }
}

function inFlight() {
  return apiError({
    type: "idempotency_error",
    code: "idempotency_in_flight",
    message:
      "A request with this Idempotency-Key is still in progress. Retry shortly.",
    status: 409,
  });
}

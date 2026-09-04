import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type {
  VerifyCheckRequest,
  VerifyCheckResponse,
  VerifyStartRequest,
  VerifyStartResponse,
} from "@app/contracts";
import { type AppDb, verifications } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { SmsService } from "../sms/sms.service.js";
import { verifyOverview } from "./verify-read.js";

const CODE_TTL_SECONDS = 300;
const RESEND_THROTTLE_MS = 30_000;
const DEFAULT_SENDER = "FABRIC";
// V1 bills a verification as its OTP SMS (the message's reserve/commit ledger entries ARE the
// billing record). Per-verification pricing is an open product decision — see the PI-4 proposal.
const CURRENCY = "GHS";

/**
 * Verify (OTP) — V1 of the headline product (ADR-0002 golden path). One verification = one row +
 * one OTP SMS through the normal send pipeline (wallet reserve/commit, sandbox provider pinning,
 * kill-switches — all inherited). The plaintext code exists only in the SMS body and, for SANDBOX
 * tenants only, in the start response's debug_code (the quickstart affordance).
 */
@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(SmsService) private readonly sms: SmsService,
  ) {}

  async start(
    tenantId: string,
    request: VerifyStartRequest,
    // ADR-0004: the presenting key's environment/application. A sandbox key MUST route the OTP send
    // through the virtual phone (never the carrier) — same routing sms.send does. Absent on the BFF
    // token path, which falls back to the tenant/plan mode inside sms.send.
    routing: {
      environmentId?: string | null;
      applicationId?: string | null;
    } = {},
  ): Promise<VerifyStartResponse> {
    const msisdnHash = sha256(request.to);
    await this.assertNotThrottled(tenantId, msisdnHash);

    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const salt = randomBytes(8).toString("hex");
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);

    await this.db.withTenantDrizzle(tenantId, async (tx) => {
      await tx.insert(verifications).values({
        id,
        tenantId: tenantId as never,
        msisdnHash,
        msisdnMasked: maskMsisdn(request.to),
        codeHash: hashCode(code, id, salt),
        codeSalt: salt,
        expiresAt,
      });
    });

    // OTP rides the normal send pipeline — billing, sandbox pinning, kill-switches inherited.
    // A failed send (no funds, paused platform…) marks the verification failed and surfaces the
    // send's own structured error: never a pending verification whose code was never sent.
    let messageId: string;
    try {
      const sent = await this.sms.send({
        tenantId,
        to: request.to,
        senderId: request.sender_id ?? DEFAULT_SENDER,
        body: `Your Fabric verification code is ${code}. It expires in 5 minutes.`,
        currency: CURRENCY,
        environmentId: routing.environmentId ?? null,
        applicationId: routing.applicationId ?? null,
      });
      messageId = sent.id;
    } catch (error) {
      await this.db.withTenantDrizzle(tenantId, (tx) =>
        tx
          .update(verifications)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(verifications.id, id)),
      );
      throw error;
    }
    await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .update(verifications)
        .set({ messageId, updatedAt: new Date() })
        .where(eq(verifications.id, id)),
    );

    // debug_code leaks the OTP by design — STRICTLY sandbox tenants. Opposite failure posture to
    // send routing: when the plan can't be confirmed, do NOT include it.
    const sandbox = await this.isConfirmedSandbox(tenantId);
    return {
      id,
      status: "pending",
      to: maskMsisdn(request.to),
      channel: "sms",
      expires_in: CODE_TTL_SECONDS,
      expires_at: expiresAt.toISOString(),
      ...(sandbox ? { debug_code: code } : {}),
    };
  }

  async check(
    tenantId: string,
    request: VerifyCheckRequest,
  ): Promise<VerifyCheckResponse> {
    // The transaction RETURNS an outcome and the throw happens AFTER commit — throwing inside
    // the tx callback would roll back the attempt increment / status flip, and the attempt
    // counter is the brute-force bound: it must persist even (especially) on the failure paths.
    const outcome = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      // FOR UPDATE: concurrent checks against one verification serialize — the counter must
      // never lose an increment to a race.
      const [row] = await tx
        .select()
        .from(verifications)
        .where(eq(verifications.id, request.id))
        .for("update")
        .limit(1);
      if (!row) return { kind: "not_found" as const };
      const now = new Date();
      // Re-checking an already-verified id is an idempotent success, not an error.
      if (row.status === "verified") {
        return {
          kind: "verified" as const,
          id: row.id,
          verifiedAt: row.verifiedAt ?? now,
        };
      }
      if (row.status === "failed") return { kind: "exhausted" as const };
      if (row.status === "expired" || row.expiresAt <= now) {
        if (row.status !== "expired") {
          await tx
            .update(verifications)
            .set({ status: "expired", updatedAt: now })
            .where(eq(verifications.id, row.id));
        }
        return { kind: "expired" as const };
      }
      if (hashCode(request.code, row.id, row.codeSalt) === row.codeHash) {
        await tx
          .update(verifications)
          .set({ status: "verified", verifiedAt: now, updatedAt: now })
          .where(eq(verifications.id, row.id));
        return { kind: "verified" as const, id: row.id, verifiedAt: now };
      }
      const attempts = row.attemptCount + 1;
      const exhausted = attempts >= row.maxAttempts;
      await tx
        .update(verifications)
        .set({
          attemptCount: attempts,
          ...(exhausted ? { status: "failed" as const } : {}),
          updatedAt: now,
        })
        .where(eq(verifications.id, row.id));
      return exhausted
        ? { kind: "exhausted" as const }
        : { kind: "wrong" as const, remaining: row.maxAttempts - attempts };
    });

    switch (outcome.kind) {
      case "verified":
        return {
          id: outcome.id,
          status: "verified",
          verified_at: outcome.verifiedAt.toISOString(),
        };
      case "not_found":
        throw notFound(
          "verification_not_found",
          "No verification with that id.",
        );
      case "expired":
        throw invalidRequest(
          "verification_expired",
          "This code has expired. Start a new verification.",
        );
      case "exhausted":
        throw invalidRequest(
          "verification_exhausted",
          "This verification has no attempts left. Start a new one.",
        );
      case "wrong":
        throw invalidRequest(
          "verification_invalid_code",
          `That code is wrong. ${outcome.remaining} attempt(s) left.`,
          "code",
        );
    }
  }

  async overview(tenantId: string) {
    return verifyOverview(this.db, tenantId);
  }

  private async assertNotThrottled(
    tenantId: string,
    msisdnHash: string,
  ): Promise<void> {
    const [latest] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({ createdAt: verifications.createdAt })
        .from(verifications)
        .where(
          and(
            eq(verifications.tenantId, tenantId as never),
            eq(verifications.msisdnHash, msisdnHash),
          ),
        )
        .orderBy(desc(verifications.createdAt))
        .limit(1),
    );
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < RESEND_THROTTLE_MS
    ) {
      throw invalidRequest(
        "verify_resend_throttled",
        "A code was just sent to this number. Wait before requesting another.",
        "to",
      );
    }
  }

  /** True only when the plan is POSITIVELY sandbox — a lookup failure must not leak debug_code. */
  private async isConfirmedSandbox(tenantId: string): Promise<boolean> {
    try {
      const rows = (await this.db.withTenant(
        tenantId,
        (tx) => tx`SELECT plan FROM accounts WHERE id = ${tenantId}`,
      )) as Array<{ plan?: unknown }>;
      return rows[0]?.plan === "sandbox";
    } catch (error) {
      this.logger.error(
        `plan lookup failed for ${tenantId} — withholding debug_code: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return false;
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCode(code: string, id: string, salt: string): string {
  return sha256(`${code}:${id}:${salt}`);
}

/** "+233545227189" → "+23354•••7189" — enough to recognize, never the full number. */
function maskMsisdn(to: string): string {
  if (to.length <= 9) return `${to.slice(0, 3)}•••`;
  return `${to.slice(0, 6)}•••${to.slice(-4)}`;
}

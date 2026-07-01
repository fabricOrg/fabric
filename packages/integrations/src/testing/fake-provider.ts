// ============================================================================================
// FakeProvider (F5.1 / L4) — the deterministic SmsSenderPlugin for sandbox + tests (QA / adams).
// Target: packages/integrations/src/testing/fake-provider.ts. Implements pascal's frozen contract.
//
// Scenario is selected by MAGIC MSISDN on `msg.to` (F8.5) — no field on the contract, keeping it
// clean. Country code 999 is ITU-reserved/unroutable → these numbers never overlap a real subscriber;
// sandbox-only (sk_test_). B2: providerRef is a deterministic function of our messageId, so a BullMQ
// retry re-sends idempotently (same ref, no double-send). The engine-crash timing (B2's other half)
// is L5 fault-injection, not the fake.
// ============================================================================================

import type { MessageStatus } from "@app/contracts";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  NormalizedMessage,
  ProviderResult,
  RequestContext,
  SmsSenderPlugin,
} from "../plugin.js";
import {
  PLATFORM_FAULT_CAUSES,
  type PlatformFaultCause,
  STATUS_RANK,
} from "../status.js";

export type FakeScenario =
  | "delivered" // accepted → DLR delivered            — billed at `accepted`, stays committed
  | "undelivered" // accepted → DLR undelivered (carrier reject, still provider-billable) — stays committed
  | "platform_fault" // accepted → DLR failed w/ internal_error — committed then REFUNDED (fault exemption)
  | "no_dlr" // accepted → no DLR → sweeper marks `expired` — COMMITTED-THEN-EXPIRED, **no refund** (S4)
  | "no_ack" // send returns `sending`, never reaches a billable status → sweeper REFUNDS at TTL (S6)
  | "reject"; // send() throws — provider refuses at submit → never billable

// Magic MSISDN → scenario. Adjust freely — this map is the QA-owned sandbox contract (F8.5).
// NOTE (fifi money-semantics): `no_dlr` (S4) stays BILLED (committed at `accepted`, just no DLR → expired);
// the sweeper REFUND path is a distinct scenario — `no_ack` (S6) — where the reservation never reaches a
// billable status. The pipeline/B6 gate must assert BOTH: S4 expired-but-unchanged, S6 swept-refund.
export const MAGIC_MSISDNS = {
  "+999900000001": "delivered",
  "+999900000002": "undelivered",
  "+999900000003": "platform_fault",
  "+999900000004": "no_dlr",
  "+999900000005": "reject",
  "+999900000006": "no_ack",
} as const satisfies Record<string, FakeScenario>;

/** Scenario for a destination; any non-magic number is the happy path (accepted → delivered). */
export function scenarioFor(to: string): FakeScenario {
  return (MAGIC_MSISDNS as Record<string, FakeScenario>)[to] ?? "delivered";
}

/** Deterministic provider ref from our internal messageId → retried send() is idempotent (B2). */
function providerRefFor(messageId: string): string {
  return `fake-${messageId}`;
}

/** The fake's DLR wire shape (what a real provider POSTs); `parseDlr` maps it to CanonicalDlr. */
export interface FakeDlrPayload {
  readonly providerRef: string;
  readonly status: MessageStatus;
  readonly faultCause?: PlatformFaultCause;
  readonly occurredAt: string;
  readonly segments?: number;
}

export class FakeProviderError extends Error {}

function isMessageStatus(s: unknown): s is MessageStatus {
  // STATUS_RANK is Record<MessageStatus, number> — its keys ARE the 8 canonical statuses.
  return typeof s === "string" && s in STATUS_RANK;
}

export class FakeProvider implements SmsSenderPlugin {
  readonly slug = "fake-sms";
  readonly capability = "sms" as const;
  readonly version = "0.1.0";
  readonly configSchema = {};
  // Commit-on-submission-ack (honest-billing default); the fake exempts every platform-fault cause.
  readonly billableStatuses: readonly MessageStatus[] = ["accepted"];
  readonly platformFaultExemptions: readonly PlatformFaultCause[] =
    PLATFORM_FAULT_CAUSES;

  supports(_ctx: RequestContext): boolean {
    return true; // the fake handles everything in sandbox
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  send(msg: NormalizedMessage, _creds: Creds): Promise<ProviderResult> {
    const scenario = scenarioFor(msg.to);
    if (scenario === "reject") {
      return Promise.reject(
        new FakeProviderError(
          `fake provider rejected submission for ${msg.to}`,
        ),
      );
    }
    if (scenario === "no_ack") {
      // Connected but submission NEVER acknowledged → NO providerRef (pascal made it optional), status
      // stays `sending`. Never reaches billableStatuses[0]='accepted', so L5 never commits and the TTL
      // sweeper REFUNDS (F3.3). providerRef present ⟺ accepted — the crisp submission-ack invariant.
      return Promise.resolve({
        status: "sending",
        raw: { fake: true, scenario },
      });
    }
    return Promise.resolve({
      providerRef: providerRefFor(msg.messageId),
      status: "accepted",
      raw: { fake: true, scenario },
    });
  }

  parseDlr(payload: unknown): CanonicalDlr {
    const p = payload as Partial<FakeDlrPayload> | null;
    if (!p || typeof p.providerRef !== "string" || !isMessageStatus(p.status)) {
      // Mirrors a real adapter: an unmapped/garbage status must throw, never silently pass (B1).
      throw new FakeProviderError("unparseable or unmapped fake DLR payload");
    }
    // exactOptionalPropertyTypes: OMIT optional fields when absent (never set them to `undefined`).
    return {
      providerRef: p.providerRef,
      status: p.status,
      ...(p.faultCause !== undefined ? { faultCause: p.faultCause } : {}),
      ...(p.occurredAt !== undefined ? { occurredAt: p.occurredAt } : {}),
      ...(p.segments !== undefined ? { segments: p.segments } : {}),
      raw: payload,
    };
  }

  verifyWebhook(_req: IncomingRequest, _creds: Creds): boolean {
    return true; // fake accepts any webhook; a real adapter verifies an HMAC over rawBody
  }

  // ---- TEST AFFORDANCE (not part of SmsSenderPlugin) ------------------------------------------
  // The DLR the message's scenario dictates — or null for the no-DLR (sweeper) + reject cases.
  // L5 / the webhook-ingress test feeds this to parseDlr, mirroring a provider POSTing a DLR.
  // Stateless: derived purely from msg.to + msg.messageId. occurredAt is caller-supplied for
  // deterministic tests.
  dlrFor(
    msg: NormalizedMessage,
    occurredAt = "1970-01-01T00:00:00.000Z",
  ): FakeDlrPayload | null {
    const providerRef = providerRefFor(msg.messageId);
    switch (scenarioFor(msg.to)) {
      case "delivered":
        return {
          providerRef,
          status: "delivered",
          occurredAt,
          segments: msg.segments,
        };
      case "undelivered":
        return {
          providerRef,
          status: "undelivered",
          occurredAt,
          segments: msg.segments,
        };
      case "platform_fault":
        return {
          providerRef,
          status: "failed",
          faultCause: "internal_error",
          occurredAt,
        };
      default:
        return null; // no_dlr (accepted→expired), no_ack (stuck sending→swept), reject → no DLR arrives
    }
  }
}

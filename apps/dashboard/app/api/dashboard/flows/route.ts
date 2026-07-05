import { type NextRequest, NextResponse } from "next/server";

/**
 * Mock verify→charge→notify orchestrator.
 * TODO(BFF): replace with the real saga in services/api — Verify(E6) → Paystack collect(E4) →
 * double-entry post(E3) → send(E5), one correlation id + an immutable audit entry, idempotent on
 * correlationId. See docs/PI-5/LIGHTHOUSE-FLOW.md. This stub proves the seam + the reconciled record.
 */

const E164 = /^\+[1-9]\d{7,14}$/;
const DEMO_CODE = "123456";

function fail(message: string, code = "invalid_request", status = 422) {
  return NextResponse.json(
    { error: { type: "validation_error", code, message } },
    { status },
  );
}

function mask(msisdn: string): string {
  return `${msisdn.slice(0, 6)}●●●${msisdn.slice(-2)}`;
}

function validAmount(minor: unknown): minor is string {
  return typeof minor === "string" && /^[0-9]+$/.test(minor) && minor !== "0";
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("Malformed request body.", "invalid_request", 400);
  }

  const msisdn = typeof body.msisdn === "string" ? body.msisdn.trim() : "";
  const currency = typeof body.currency === "string" ? body.currency : "GHS";
  const minor = body.minor;
  const channel = typeof body.channel === "string" ? body.channel : "sms";

  if (!E164.test(msisdn)) return fail("Enter a valid E.164 phone number.");
  if (!validAmount(minor)) return fail("Enter an amount greater than zero.");

  if (body.action === "start") {
    return NextResponse.json({
      correlationId: `corr_${crypto.randomUUID().slice(0, 12)}`,
      verificationId: `ver_${crypto.randomUUID().slice(0, 10)}`,
      otpSentTo: mask(msisdn),
    });
  }

  if (body.action === "confirm") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code !== DEMO_CODE) {
      // Verification fails → stop BEFORE any charge (no money moves).
      return fail("That verification code is incorrect.", "otp_invalid", 422);
    }
    const correlationId =
      typeof body.correlationId === "string"
        ? body.correlationId
        : `corr_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const amount = { currency, minor };

    // Balanced double-entry posting: customer collection (debit) → tenant wallet (credit).
    return NextResponse.json({
      correlationId,
      createdAt: now,
      customer: mask(msisdn),
      channel,
      amount,
      verify: {
        status: "done",
        verificationId: `ver_${crypto.randomUUID().slice(0, 10)}`,
        at: now,
      },
      charge: {
        status: "done",
        at: now,
        entries: [
          {
            account: "payments:collection-clearing",
            label: "Customer collection",
            direction: "debit",
            amount,
          },
          {
            account: "wallet:available",
            label: "Tenant wallet",
            direction: "credit",
            amount,
          },
        ],
      },
      notify: {
        status: "done",
        messageId: `msg_${crypto.randomUUID().slice(0, 10)}`,
        at: now,
      },
      audit: { actor: "you@fabric", at: now },
    });
  }

  return fail("Unknown flow action.", "invalid_request", 400);
}

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

function entry(
  label: string,
  account: string,
  direction: "debit" | "credit",
  minor: string,
) {
  return { label, account, direction, amount: { currency: "GHS", minor } };
}

function buildTxn(t: {
  id: string;
  customer: string;
  channel: string;
  minor: string;
  notify: "done" | "failed";
  at: string;
}) {
  const amount = { currency: "GHS", minor: t.minor };
  return {
    correlationId: t.id,
    createdAt: t.at,
    customer: t.customer,
    channel: t.channel,
    amount,
    verify: {
      status: "done",
      verificationId: `ver_${t.id.slice(5)}`,
      at: t.at,
    },
    charge: {
      status: "done",
      at: t.at,
      entries: [
        entry(
          "Customer collection",
          "payments:collection-clearing",
          "debit",
          t.minor,
        ),
        entry("Tenant wallet", "wallet:available", "credit", t.minor),
      ],
    },
    notify: {
      status: t.notify,
      messageId: t.notify === "done" ? `msg_${t.id.slice(5)}` : null,
      at: t.notify === "done" ? t.at : null,
    },
    audit: { actor: "you@fabric", at: t.at },
  };
}

// Reconciled transactions for the explorer. TODO(BFF): served by /v1/flows (the real saga's records).
const SAMPLE = [
  buildTxn({
    id: "corr_9f2a1c8d",
    customer: "+23320●●●42",
    channel: "sms",
    minor: "5000",
    notify: "done",
    at: "2026-07-05T09:12:00Z",
  }),
  buildTxn({
    id: "corr_7b3e8841",
    customer: "+23324●●●17",
    channel: "whatsapp",
    minor: "12000",
    notify: "done",
    at: "2026-07-05T08:40:00Z",
  }),
  buildTxn({
    id: "corr_5c1d2077",
    customer: "+23420●●●90",
    channel: "sms",
    minor: "2500",
    notify: "failed",
    at: "2026-07-04T22:03:00Z",
  }),
];

// Daily throughput for the trend chart — volume collected + transaction count. TODO(BFF): real rollup.
const SERIES = [
  { date: "Jun 22", volumeMinor: "18500", count: 4 },
  { date: "Jun 23", volumeMinor: "22000", count: 5 },
  { date: "Jun 24", volumeMinor: "15000", count: 3 },
  { date: "Jun 25", volumeMinor: "31000", count: 7 },
  { date: "Jun 26", volumeMinor: "27500", count: 6 },
  { date: "Jun 27", volumeMinor: "12000", count: 3 },
  { date: "Jun 28", volumeMinor: "9500", count: 2 },
  { date: "Jun 29", volumeMinor: "24000", count: 5 },
  { date: "Jun 30", volumeMinor: "29500", count: 6 },
  { date: "Jul 1", volumeMinor: "34000", count: 8 },
  { date: "Jul 2", volumeMinor: "30500", count: 7 },
  { date: "Jul 3", volumeMinor: "26000", count: 6 },
  { date: "Jul 4", volumeMinor: "35500", count: 8 },
  { date: "Jul 5", volumeMinor: "17000", count: 4 },
];

export async function GET() {
  return NextResponse.json({ transactions: SAMPLE, series: SERIES });
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

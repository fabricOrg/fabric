import type { LedgerEntry, Money } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { getMessageList, getWalletSnapshot } from "@/lib/server/dashboard-data";

/**
 * Overview home summary — assembled from the REAL wallet + messages reads (no mock). Money stays
 * exact bigint minor units end to end. Channels other than SMS aren't implemented yet, so spend-by-
 * channel reports SMS only (honest) rather than inventing WhatsApp/Voice/Verify lines.
 */

const RESOLVED = new Set(["delivered", "undelivered", "failed", "expired"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const TRAFFIC_DAYS = 14;

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD (ISO date portion)
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export async function GET() {
  try {
    const [wallet, messageList] = await Promise.all([
      getWalletSnapshot(),
      getMessageList(),
    ]);
    const messages = messageList.messages;

    const primaryCurrency = wallet.balances[0]?.balance.currency ?? "GHS";
    const walletBalance: Money = wallet.balances[0]?.balance ?? {
      currency: primaryCurrency,
      minor: "0",
    };

    // Month-to-date window (local calendar month).
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Spend this month = Σ sms_charge debits (exact bigint minor units).
    const spendMinor = wallet.ledger
      .filter(
        (e: LedgerEntry) =>
          e.type === "sms_charge" &&
          new Date(e.createdAt).getTime() >= monthStart,
      )
      .reduce((sum, e) => sum + BigInt(e.amount.minor), 0n);
    const spendThisMonth: Money = {
      currency: primaryCurrency,
      minor: spendMinor.toString(),
    };

    // This-month message stats.
    const monthMessages = messages.filter(
      (m) => new Date(m.created_at).getTime() >= monthStart,
    );
    const resolved = monthMessages.filter((m) => RESOLVED.has(m.status));
    const delivered = monthMessages.filter((m) => m.status === "delivered");
    const deliveryRate = resolved.length
      ? delivered.length / resolved.length
      : 0;

    // Last-14-days traffic: sent (created that day) vs delivered (that day). Buckets oldest→newest.
    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setTime(windowStart.getTime() - (TRAFFIC_DAYS - 1) * DAY_MS);
    const buckets = new Map<string, { sent: number; delivered: number }>();
    const traffic: { date: string; sent: number; delivered: number }[] = [];
    for (let i = 0; i < TRAFFIC_DAYS; i++) {
      const d = new Date(windowStart.getTime() + i * DAY_MS);
      buckets.set(dayKey(d.toISOString()), { sent: 0, delivered: 0 });
      traffic.push({ date: dayLabel(d), sent: 0, delivered: 0 });
    }
    for (const m of messages) {
      const bucket = buckets.get(dayKey(m.created_at));
      if (!bucket) continue;
      bucket.sent += 1;
      if (m.status === "delivered") bucket.delivered += 1;
    }
    // Reflect bucket counts back onto the ordered array.
    for (let i = 0; i < TRAFFIC_DAYS; i++) {
      const d = new Date(windowStart.getTime() + i * DAY_MS);
      const bucket = buckets.get(dayKey(d.toISOString()));
      const point = traffic[i];
      if (bucket && point) {
        point.sent = bucket.sent;
        point.delivered = bucket.delivered;
      }
    }

    // Recent activity = latest messages + top-ups, merged, newest first.
    const activity = [
      ...messages.map((m) => ({
        id: m.id,
        kind: "message" as const,
        label: m.to,
        at: m.created_at,
        status: m.status,
      })),
      ...wallet.ledger
        .filter((e) => e.type === "topup")
        .map((e) => ({
          id: e.id,
          kind: "topup" as const,
          label: "Wallet top-up",
          at: e.createdAt,
          status: "completed",
        })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 6);

    return NextResponse.json({
      messagesSent: monthMessages.length,
      deliveryRate,
      spendThisMonth,
      walletBalance,
      traffic,
      spendByChannel: [{ channel: "sms", spend: spendThisMonth }],
      recentActivity: activity,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof BffError) {
    return NextResponse.json(error.payload, { status: error.status });
  }
  // dashboard-data's unwrap() throws the API error envelope directly.
  if (error && typeof error === "object" && "error" in error) {
    return NextResponse.json(error, { status: 502 });
  }
  return NextResponse.json(
    {
      error: {
        type: "api_error",
        code: "bff_error",
        message: "Request failed.",
      },
    },
    { status: 500 },
  );
}

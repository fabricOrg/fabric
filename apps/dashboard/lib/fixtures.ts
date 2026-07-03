// Typed mock data for the dashboard — shapes come straight from @app/contracts so screens build
// against the real DTOs now and swap to the BFF later with zero shape churn. All money is minor-unit
// strings; recipients are masked (PII). Covers all 8 canonical statuses so the log/chips are exercised.

import type {
  LedgerEntry,
  MessageDetail,
  MessageSummary,
  WalletBalance,
} from "@app/contracts";

export const SENDER_IDS: readonly string[] = ["JOJO", "Fabric", "AcmeOTP"];

export const MESSAGES = [
  {
    id: "msg_01H8",
    to: "+233 24● ●●● ●●12",
    status: "delivered",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T09:41:02Z",
  },
  {
    id: "msg_01H7",
    to: "+234 80● ●●● ●●45",
    status: "sent",
    encoding: "ucs2",
    segments: 2,
    cost: { currency: "NGN", minor: "800" },
    provider: "termii",
    createdAt: "2026-07-03T09:38:10Z",
  },
  {
    id: "msg_01H6",
    to: "+233 20● ●●● ●●88",
    status: "accepted",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T09:36:55Z",
  },
  {
    id: "msg_01H5",
    to: "+233 27● ●●● ●●03",
    status: "sending",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T09:35:20Z",
  },
  {
    id: "msg_01H4",
    to: "+233 55● ●●● ●●71",
    status: "queued",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T09:34:01Z",
  },
  {
    id: "msg_01H3",
    to: "+234 81● ●●● ●●27",
    status: "undelivered",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "NGN", minor: "400" },
    provider: "termii",
    createdAt: "2026-07-03T09:12:44Z",
  },
  {
    id: "msg_01H2",
    to: "+233 24● ●●● ●●99",
    status: "failed",
    encoding: "ucs2",
    segments: 3,
    cost: { currency: "GHS", minor: "9" },
    provider: "hubtel",
    createdAt: "2026-07-03T08:58:31Z",
  },
  {
    id: "msg_01H1",
    to: "+233 50● ●●● ●●16",
    status: "expired",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T08:40:09Z",
  },
] as const satisfies readonly MessageSummary[];

export const MESSAGE_DETAILS: Readonly<Record<string, MessageDetail>> = {
  msg_01H2: {
    id: "msg_01H2",
    to: "+233 24● ●●● ●●99",
    status: "failed",
    encoding: "ucs2",
    segments: 3,
    cost: { currency: "GHS", minor: "9" },
    provider: "hubtel",
    createdAt: "2026-07-03T08:58:31Z",
    senderId: "JOJO",
    body: "Your OTP is 402913 — expires in 5 minutes. 🔐",
    redacted: false,
    failureReason:
      "Rejected by carrier: sender ID not registered on this route.",
    requestId: "req_8f2c4a1b",
    timeline: [
      { status: "queued", at: "2026-07-03T08:58:31Z" },
      { status: "sending", at: "2026-07-03T08:58:32Z" },
      {
        status: "failed",
        at: "2026-07-03T08:58:40Z",
        note: "carrier reject 0x21",
      },
    ],
  },
  msg_01H8: {
    id: "msg_01H8",
    to: "+233 24● ●●● ●●12",
    status: "delivered",
    encoding: "gsm7",
    segments: 1,
    cost: { currency: "GHS", minor: "3" },
    provider: "hubtel",
    createdAt: "2026-07-03T09:41:02Z",
    senderId: "Fabric",
    redacted: true,
    timeline: [
      { status: "queued", at: "2026-07-03T09:41:02Z" },
      { status: "accepted", at: "2026-07-03T09:41:03Z" },
      { status: "sent", at: "2026-07-03T09:41:04Z" },
      { status: "delivered", at: "2026-07-03T09:41:09Z" },
    ],
  },
};

export const WALLET_BALANCES = [
  {
    balance: { currency: "GHS", minor: "120403" },
    lowBalanceThreshold: { currency: "GHS", minor: "5000" },
  },
  { balance: { currency: "NGN", minor: "342000" } },
] as const satisfies readonly WalletBalance[];

export const LEDGER = [
  {
    id: "led_09",
    type: "sms_charge",
    direction: "debit",
    amount: { currency: "GHS", minor: "3" },
    runningBalance: { currency: "GHS", minor: "120403" },
    createdAt: "2026-07-03T09:41:02Z",
    reference: "msg_01H8",
  },
  {
    id: "led_08",
    type: "topup",
    direction: "credit",
    amount: { currency: "GHS", minor: "50000" },
    runningBalance: { currency: "GHS", minor: "120406" },
    createdAt: "2026-07-03T08:00:00Z",
    reference: "pay_7742",
  },
  {
    id: "led_07",
    type: "refund",
    direction: "credit",
    amount: { currency: "GHS", minor: "9" },
    runningBalance: { currency: "GHS", minor: "70406" },
    createdAt: "2026-07-03T07:55:12Z",
    reference: "msg_01H2",
  },
  {
    id: "led_06",
    type: "adjustment",
    direction: "debit",
    amount: { currency: "GHS", minor: "100" },
    runningBalance: { currency: "GHS", minor: "70397" },
    createdAt: "2026-07-02T18:20:00Z",
    reference: "adj_ops_31",
  },
] as const satisfies readonly LedgerEntry[];

/** A representative F8.3 error envelope for exercising the error state / toast helper. */
export const SAMPLE_ERROR = {
  error: {
    type: "api_error",
    code: "internal_error",
    message: "We couldn't load this right now. Please try again.",
  },
  request_id: "req_3a9f21c7",
} as const;

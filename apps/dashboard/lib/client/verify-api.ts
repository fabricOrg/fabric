// Verify (OTP) product client + app-local DTOs. Mock-first: these zod schemas live in the app
// (not @app/contracts yet) and validate the BFF stub's JSON so the UI never trusts an unshaped body.
// Verify is one API that fans an OTP across channels (SMS/Voice/WhatsApp/Email) with failover order.
// TODO(BFF): promote to @app/contracts + wire /v1/verify (mirror messages/wallet contracts).

import { z } from "zod";

/** Channels an OTP can travel over. Order = failover priority (try channel #1, fall back to #2…). */
export const verifyChannelName = z.enum(["sms", "voice", "whatsapp", "email"]);
export type VerifyChannelName = z.infer<typeof verifyChannelName>;

/** Verification lifecycle. pending is in-flight; verified/expired/failed are terminal. */
export const verifyStatus = z.enum([
  "pending",
  "verified",
  "expired",
  "failed",
]);
export type VerifyStatus = z.infer<typeof verifyStatus>;

/** A configured channel row. `order` is the failover rank (1 = tried first) among ENABLED channels. */
export const verifyChannel = z.object({
  channel: verifyChannelName,
  enabled: z.boolean(),
  order: z.number().int().positive(),
});
export type VerifyChannel = z.infer<typeof verifyChannel>;

/** A single verification attempt. verifiedAt is set only once status flips to "verified". */
export const verification = z.object({
  id: z.string(),
  msisdn: z.string(),
  channel: verifyChannelName,
  status: verifyStatus,
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type Verification = z.infer<typeof verification>;

/**
 * Funnel counters. The BFF guarantees verified ≤ delivered ≤ sent; the UI treats these as
 * authoritative and never recomputes totals — it only derives rates for display.
 */
export const conversionStats = z.object({
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
});
export type ConversionStats = z.infer<typeof conversionStats>;

/** One day of verification activity — attempts started vs successfully verified (verified ≤ attempts). */
export const verifyTrendPoint = z.object({
  date: z.string(),
  attempts: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
});
export type VerifyTrendPoint = z.infer<typeof verifyTrendPoint>;

export const verifyOverviewResponse = z.object({
  channels: z.array(verifyChannel),
  recent: z.array(verification),
  stats: conversionStats,
  trend: z.array(verifyTrendPoint),
});
export type VerifyOverview = z.infer<typeof verifyOverviewResponse>;

/** Start a test verification: pick a destination + channel, get back a pending Verification. */
export const startVerificationRequest = z.object({
  action: z.literal("start"),
  msisdn: z.string().min(1),
  channel: verifyChannelName,
});
export type StartVerificationRequest = z.infer<typeof startVerificationRequest>;

/** Check the code entered by the user against the pending verification. */
export const checkVerificationRequest = z.object({
  action: z.literal("check"),
  id: z.string().min(1),
  code: z.string().min(1),
});
export type CheckVerificationRequest = z.infer<typeof checkVerificationRequest>;

/** Persist the channel matrix (enabled + failover order). Optimistic on the client. */
export const saveChannelsRequest = z.object({
  action: z.literal("save-channels"),
  channels: z.array(verifyChannel),
});
export type SaveChannelsRequest = z.infer<typeof saveChannelsRequest>;

const verificationResponse = z.object({ verification });
const saveChannelsResponse = z.object({ channels: z.array(verifyChannel) });

/** The 6-digit code that simulates a successful verification in the mock BFF (demo aid). */
export const DEMO_OK_CODE = "123456";

/** Mirrors the shared BFF fetch: throws the raw error payload so callers route it through toastApiError. */
async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function getVerifyOverview(): Promise<VerifyOverview> {
  return verifyOverviewResponse.parse(
    await bffRequest("/api/dashboard/verify"),
  );
}

export async function startVerification(
  input: Omit<StartVerificationRequest, "action">,
): Promise<Verification> {
  const parsed = verificationResponse.parse(
    await bffRequest("/api/dashboard/verify", {
      method: "POST",
      body: JSON.stringify({ action: "start", ...input }),
    }),
  );
  return parsed.verification;
}

export async function checkVerification(
  input: Omit<CheckVerificationRequest, "action">,
): Promise<Verification> {
  const parsed = verificationResponse.parse(
    await bffRequest("/api/dashboard/verify", {
      method: "POST",
      body: JSON.stringify({ action: "check", ...input }),
    }),
  );
  return parsed.verification;
}

export async function saveChannels(
  channels: VerifyChannel[],
): Promise<VerifyChannel[]> {
  const parsed = saveChannelsResponse.parse(
    await bffRequest("/api/dashboard/verify", {
      method: "POST",
      body: JSON.stringify({ action: "save-channels", channels }),
    }),
  );
  return parsed.channels;
}

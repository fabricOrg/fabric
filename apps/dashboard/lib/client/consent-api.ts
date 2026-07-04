// Consent & DND (Do-Not-Disturb) client + app-local DTOs.
// TODO(BFF): promote these schemas to @app/contracts + wire /v1/consent so services and the
// dashboard validate against the SAME definitions (no drift). They live here for the mock-first
// screen only; the BFF stub at /api/dashboard/consent returns matching mock JSON.

import { z } from "zod";

/** E.164 (shared with the Send screen): leading +, no leading zero, 8–15 digits total. */
export const E164 = /^\+[1-9]\d{7,14}$/;

/** A number can opt out of everything, or only of promotional/marketing traffic. */
export const optOutScope = z.enum(["all", "promotional"]);
export type OptOutScope = z.infer<typeof optOutScope>;

/**
 * How the opt-out was captured:
 * - STOP-reply    — subscriber replied STOP to a message.
 * - 2442-registry — synced from Nigeria's central 2442 DND registry.
 * - manual        — added by an operator in this dashboard.
 */
export const optOutSource = z.enum(["STOP-reply", "2442-registry", "manual"]);
export type OptOutSource = z.infer<typeof optOutSource>;

export const optOut = z.object({
  id: z.string(),
  msisdn: z.string().regex(E164),
  scope: optOutScope,
  source: optOutSource,
  at: z.string(), // ISO 8601
});
export type OptOut = z.infer<typeof optOut>;

export const quietHours = z.object({
  start: z.string(), // "HH:MM", 24h
  end: z.string(), // "HH:MM", 24h
  timezone: z.string(), // IANA, e.g. "Africa/Lagos"
  enabled: z.boolean(),
});
export type QuietHours = z.infer<typeof quietHours>;

export const classificationCategory = z.enum(["promotional", "transactional"]);
export type ClassificationCategory = z.infer<typeof classificationCategory>;

/**
 * Traffic classification rule. Transactional (OTP/alerts) bypasses DND & quiet hours; promotional
 * is filtered against opt-outs AND time-boxed to the allowed window.
 */
export const classificationRule = z.object({
  category: classificationCategory,
  dndFiltered: z.boolean(),
  quietHoursEnforced: z.boolean(),
  description: z.string(),
});
export type ClassificationRule = z.infer<typeof classificationRule>;

export const consentSnapshot = z.object({
  optOuts: z.array(optOut),
  quietHours,
  rules: z.array(classificationRule),
});
export type ConsentSnapshot = z.infer<typeof consentSnapshot>;

export interface AddOptOutInput {
  readonly msisdn: string;
  readonly scope: OptOutScope;
}

// Response envelopes the BFF stub returns for mutations (kept local to this lane).
const addOptOutResponse = z.object({ optOut });
const saveQuietHoursResponse = z.object({ quietHours });

/** Mirrors lib/client/dashboard-api.ts: throw the raw error payload so callers route it to toastApiError. */
async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function getConsent(): Promise<ConsentSnapshot> {
  return consentSnapshot.parse(await bffRequest("/api/dashboard/consent"));
}

export async function addOptOut(input: AddOptOutInput): Promise<OptOut> {
  const parsed = addOptOutResponse.parse(
    await bffRequest("/api/dashboard/consent", {
      method: "POST",
      body: JSON.stringify({ action: "add-optout", ...input }),
    }),
  );
  return parsed.optOut;
}

export async function saveQuietHours(input: QuietHours): Promise<QuietHours> {
  const parsed = saveQuietHoursResponse.parse(
    await bffRequest("/api/dashboard/consent", {
      method: "POST",
      body: JSON.stringify({ action: "save-quiet-hours", quietHours: input }),
    }),
  );
  return parsed.quietHours;
}

export async function removeOptOut(id: string): Promise<void> {
  await bffRequest(`/api/dashboard/consent?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

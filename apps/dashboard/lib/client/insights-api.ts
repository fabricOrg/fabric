// Messaging Insights client + app-local DTOs (mock-first, mirrors Twilio Messaging Insights).
// The analytics surface is not yet in the platform contract, so the DTOs live here for now and the
// data comes from a BFF stub (/api/dashboard/insights). When the real endpoint lands, lift these
// schemas verbatim into @app/contracts and point the fetch at /v1/insights.
//
// TODO(BFF): promote to @app/contracts + wire /v1/insights

import { z } from "zod";

/** One per-error-code bucket in the delivery breakdown (Twilio "Delivery & Errors"). */
export const insightsError = z.object({
  code: z.string(),
  description: z.string(),
  count: z.number().int().nonnegative(),
});
export type InsightsError = z.infer<typeof insightsError>;

/**
 * Rollup for the Insights tab. Invariant: delivered + failed <= totalSent (the remainder is still
 * in-flight — queued/sending/accepted/sent — so the three never over-count the window's volume).
 */
export const insightsSummary = z
  .object({
    totalSent: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    avgSegments: z.number().nonnegative(),
    errors: z.array(insightsError),
  })
  .refine((s) => s.delivered + s.failed <= s.totalSent, {
    message: "delivered + failed must not exceed totalSent",
    path: ["totalSent"],
  });
export type InsightsSummary = z.infer<typeof insightsSummary>;

/** BFF envelope — request_id mirrors the platform's other responses for support handoff. */
export const insightsSummaryResponse = z.object({
  summary: insightsSummary,
  request_id: z.string(),
});
export type InsightsSummaryResponse = z.infer<typeof insightsSummaryResponse>;

async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

/** Fetch the messaging insights rollup. Throws the raw API-error envelope on failure (parseApiError). */
export async function getInsightsSummary(): Promise<InsightsSummary> {
  const response = insightsSummaryResponse.parse(
    await bffRequest("/api/dashboard/insights"),
  );
  return response.summary;
}

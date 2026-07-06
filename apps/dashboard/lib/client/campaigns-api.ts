// Campaigns (bulk messaging) client + app-local DTOs. Mock-first: these zod schemas live in the app
// (not @app/contracts yet) and validate the BFF stub's JSON so the UI never trusts an unshaped body.
// Money follows the F-money convention: `minor` is exact minor units as a STRING (never a float).
// TODO(BFF): promote to @app/contracts + wire /v1/campaigns (mirror messages/wallet contracts).

import { z } from "zod";

/** Campaign lifecycle. Draft/scheduled are pre-send; sending is in-flight; completed/failed terminal. */
export const campaignStatus = z.enum([
  "draft",
  "scheduled",
  "sending",
  "completed",
  "failed",
]);
export type CampaignStatus = z.infer<typeof campaignStatus>;

/** Exact money (F-money): minor units as an integer string. Currency pinned to GHS for the thin thread. */
export const campaignMoney = z.object({
  currency: z.literal("GHS"),
  minor: z.string().regex(/^-?\d+$/, "minor must be an integer string"),
});
export type CampaignMoney = z.infer<typeof campaignMoney>;

/**
 * A bulk campaign. Delivery counters satisfy delivered + failed ≤ sent ≤ audienceSize (the BFF stub
 * generates realistic values); the UI treats these as authoritative and never recomputes totals.
 */
export const campaign = z.object({
  id: z.string(),
  name: z.string(),
  status: campaignStatus,
  audienceSize: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  optedOut: z.number().int().nonnegative(),
  body: z.string(),
  scheduledAt: z.string().nullable(),
  createdAt: z.string(),
  costEstimate: campaignMoney,
});
export type Campaign = z.infer<typeof campaign>;

export const campaignListResponse = z.object({
  campaigns: z.array(campaign),
});

/** Create payload. audienceSize is the raw list size; respectOptOuts governs promotional suppression. */
export const createCampaignRequest = z.object({
  name: z.string().min(1),
  body: z.string().min(1),
  audienceSize: z.number().int().positive(),
  scheduledAt: z.string().nullable(),
  respectOptOuts: z.boolean(),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignRequest>;

export const createCampaignResponse = z.object({ campaign });

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

export async function listCampaigns(): Promise<Campaign[]> {
  const parsed = campaignListResponse.parse(
    await bffRequest("/api/dashboard/campaigns"),
  );
  return parsed.campaigns;
}

export async function createCampaign(
  input: CreateCampaignRequest,
): Promise<Campaign> {
  const parsed = createCampaignResponse.parse(
    await bffRequest("/api/dashboard/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  return parsed.campaign;
}

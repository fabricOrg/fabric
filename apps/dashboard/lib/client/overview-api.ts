// Overview home data — client fetcher + app-local zod DTOs for the at-a-glance dashboard.
// Money stays EXACT: the shared `money` contract keeps `minor` as an integer string (bigint on the
// wire), never a float. Mirrors the bffRequest + zod-parse shape of lib/client/dashboard-api.ts.
// TODO(BFF): promote OverviewSummary to @app/contracts + wire /v1/overview once the BFF ships.

import { money } from "@app/contracts";
import { z } from "zod";

/** Billable channels shown in the spend breakdown. */
export const overviewChannel = z.enum(["sms", "whatsapp", "voice", "verify"]);
export type OverviewChannel = z.infer<typeof overviewChannel>;

/** A single recent-activity row (message send, campaign, or wallet top-up). */
export const overviewActivity = z.object({
  id: z.string(),
  kind: z.enum(["message", "campaign", "topup"]),
  label: z.string(),
  at: z.string(),
  status: z.string(),
});
export type OverviewActivity = z.infer<typeof overviewActivity>;

/** Per-channel spend — exact money, never a rounded number. */
export const overviewChannelSpend = z.object({
  channel: overviewChannel,
  spend: money,
});
export type OverviewChannelSpend = z.infer<typeof overviewChannelSpend>;

/** The whole home summary — one round-trip powers every tile on the Overview screen. */
export const overviewSummary = z.object({
  messagesSent: z.number().int().nonnegative(),
  deliveryRate: z.number().min(0).max(1),
  spendThisMonth: money,
  walletBalance: money,
  spendByChannel: z.array(overviewChannelSpend),
  recentActivity: z.array(overviewActivity),
});
export type OverviewSummary = z.infer<typeof overviewSummary>;

/** Thin BFF fetch: throws the raw error envelope on !ok so callers can toastApiError it. */
async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

/** Fetch + validate the Overview summary. Rejects with the API error envelope on failure. */
export async function getOverview(): Promise<OverviewSummary> {
  return overviewSummary.parse(await bffRequest("/api/dashboard/overview"));
}

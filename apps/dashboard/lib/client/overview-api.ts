import {
  type OverviewActivity,
  type OverviewChannel,
  type OverviewChannelSpend,
  type OverviewResponse,
  type OverviewTrafficPoint,
  overviewResponse,
} from "@app/contracts";

export type {
  OverviewActivity,
  OverviewChannel,
  OverviewChannelSpend,
  OverviewTrafficPoint,
};
export type OverviewSummary = OverviewResponse;

async function bffRequest(path: string): Promise<unknown> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function getOverview(): Promise<OverviewSummary> {
  return overviewResponse.parse(await bffRequest("/api/dashboard/overview"));
}

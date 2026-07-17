import "server-only";

import {
  type ListMessageDeliveriesResponse,
  listMessageDeliveriesResponse,
} from "@app/contracts";
import { dashboardApi } from "./api-client";

/**
 * Managed delivery logs (SDK-005) via the data-plane `/v1/message-deliveries`. dashboardApi mints a
 * short-lived tenant token from the authenticated session (ADR-0003); the tenant-token path must
 * name the environment explicitly (a BFF token carries no application scope). List rows are
 * summaries — the recipient never appears in a log listing.
 */
export async function listMessageDeliveries(
  environmentId: string,
): Promise<ListMessageDeliveriesResponse> {
  const payload = await dashboardApi<unknown>(
    `/v1/message-deliveries?environment_id=${encodeURIComponent(environmentId)}`,
    "sms:read",
  );
  return listMessageDeliveriesResponse.parse(payload);
}

import "server-only";

import {
  type ListMessageDeliveriesResponse,
  listMessageDeliveriesResponse,
  type RetrieveManagedMessageResponse,
  retrieveManagedMessageResponse,
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

export async function retrieveMessageDelivery(
  deliveryId: string,
  applicationId: string,
  environmentId: string,
): Promise<RetrieveManagedMessageResponse> {
  const query = `application_id=${encodeURIComponent(applicationId)}&environment_id=${encodeURIComponent(environmentId)}`;
  const payload = await dashboardApi<unknown>(
    `/v1/message-deliveries/${encodeURIComponent(deliveryId)}?${query}`,
    "sms:read",
  );
  return retrieveManagedMessageResponse.parse(payload);
}

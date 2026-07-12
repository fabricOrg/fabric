import "server-only";

import {
  type ListRequestLogsResponse,
  listRequestLogsResponseSchema,
} from "@app/contracts";
import { dashboardApi } from "./api-client";

/**
 * Request logs (W-B) via the data-plane `/v1/logs`. Tenant from the session (ADR-0003), scoped to an
 * application + environment, keyset-paginated (pass a prior page's next_cursor to page older).
 */
export async function listRequestLogs(
  applicationId: string,
  envType: "sandbox" | "live",
  cursor?: string,
): Promise<ListRequestLogsResponse> {
  const params = new URLSearchParams({ applicationId, env: envType });
  if (cursor) params.set("cursor", cursor);
  const payload = await dashboardApi<unknown>(
    `/v1/logs?${params.toString()}`,
    "request_logs:read",
  );
  return listRequestLogsResponseSchema.parse(payload);
}

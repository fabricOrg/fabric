import "server-only";

import {
  type ApplicationDto,
  applicationDtoSchema,
  type CreateApplicationRequest,
  type ListApplicationsResponse,
  listApplicationsResponseSchema,
} from "@app/contracts";
import { dashboardApi } from "./api-client";

/**
 * Applications management (ADR-0004) via the data-plane `/v1/applications`. dashboardApi mints a
 * short-lived tenant token from the authenticated session (ADR-0003) and enforces the membership
 * permission before the call — the tenant is the session's, never the client's. The API derives the
 * tenant from that token, so no tenantId crosses the wire. Responses are parsed against the shared
 * contract at the boundary (a shape crossing a boundary is validated, not trusted).
 */
export async function listApplications(): Promise<ListApplicationsResponse> {
  const payload = await dashboardApi<unknown>(
    "/v1/applications",
    "applications:read",
  );
  return listApplicationsResponseSchema.parse(payload);
}

export async function createApplication(
  request: CreateApplicationRequest,
): Promise<ApplicationDto> {
  const payload = await dashboardApi<unknown>(
    "/v1/applications",
    "applications:write",
    { method: "POST", body: JSON.stringify(request) },
  );
  return applicationDtoSchema.parse(payload);
}

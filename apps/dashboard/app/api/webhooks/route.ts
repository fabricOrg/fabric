import { createWebhookEndpointRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";
import { createWebhook } from "@/lib/server/webhooks-client";

/**
 * Register a webhook endpoint. Gated on `api_keys:write` (the developer surface). Scoped to an
 * application-environment (ADR-0004); the tenant is the session's, never client-supplied. The
 * signing secret is returned exactly once.
 */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.permissions.includes("api_keys:write")) {
    return bffForbidden(
      "insufficient_permission",
      "You don't have permission to manage webhooks.",
    );
  }
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const applicationId =
      typeof raw?.application_id === "string" ? raw.application_id : null;
    const env = raw?.env === "live" || raw?.env === "sandbox" ? raw.env : null;
    const parsed = createWebhookEndpointRequestSchema.safeParse(raw);
    if (!parsed.success || !applicationId || !env) {
      return bffUnprocessable(
        "invalid_request",
        !applicationId || !env
          ? "An application and environment are required."
          : (parsed.error?.issues[0]?.message ?? "Enter a valid https URL."),
      );
    }
    const result = await createWebhook({ ...parsed.data, applicationId, env });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

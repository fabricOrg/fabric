import { createWebhookEndpointRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";
import { createWebhook } from "@/lib/server/webhooks-client";

/**
 * Register a webhook endpoint. Gated on `api_keys:write` (the developer surface). Scoped to an
 * application-environment (ADR-0004); the tenant is the session's, never client-supplied. The
 * signing secret is returned exactly once.
 */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return unauthorized("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return unauthorized("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("api_keys:write")) {
    return unauthorized(
      "insufficient_permission",
      "You don't have permission to manage webhooks.",
      403,
    );
  }
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const applicationId =
      typeof raw?.application_id === "string" ? raw.application_id : null;
    const env = raw?.env === "live" || raw?.env === "sandbox" ? raw.env : null;
    const parsed = createWebhookEndpointRequestSchema.safeParse(raw);
    if (!parsed.success || !applicationId || !env) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message:
              !applicationId || !env
                ? "An application and environment are required."
                : (parsed.error?.issues[0]?.message ??
                  "Enter a valid https URL."),
          },
        },
        { status: 422 },
      );
    }
    const result = await createWebhook({ ...parsed.data, applicationId, env });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          {
            error: {
              type: "api_error",
              code: "bff_error",
              message: "Request failed.",
            },
          },
          { status: 500 },
        );
  }
}

function unauthorized(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}

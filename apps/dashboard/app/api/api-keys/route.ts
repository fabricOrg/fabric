import { createApiKeyRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { createApiKey } from "@/lib/server/api-keys-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Create an API key. Gated on the `api_keys:write` permission (owner/admin, or a developer-access
 * member) — enforced here for a clean 403, and again in the tenant-token client. The tenant is the
 * session's workspace, never client-supplied; the secret is returned exactly once.
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
      "You don't have permission to create API keys.",
      403,
    );
  }
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const applicationId =
      typeof raw?.application_id === "string" ? raw.application_id : null;
    const parsed = createApiKeyRequest.safeParse(raw);
    if (!parsed.success || !applicationId) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message: !applicationId
              ? "An application is required."
              : (parsed.error?.issues[0]?.message ??
                "Enter a name, environment, and at least one scope."),
          },
        },
        { status: 422 },
      );
    }
    // Keys are scoped to an application-environment (ADR-0004); the id comes from the app-detail page.
    const result = await createApiKey({ ...parsed.data, applicationId });
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

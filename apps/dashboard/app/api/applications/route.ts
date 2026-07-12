import { createApplicationRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { createApplication } from "@/lib/server/applications-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Create an application (ADR-0004). Owner/admin only; the tenant is the session's workspace, never
 * client-supplied. `applications:write` is also enforced downstream in the tenant-token client — the
 * role gate here is for a clear 403 before the API round-trip.
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
  if (session.role !== "owner" && session.role !== "admin") {
    return unauthorized(
      "insufficient_permission",
      "Only owners and admins can create applications.",
      403,
    );
  }
  try {
    const parsed = createApplicationRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message:
              parsed.error.issues[0]?.message ?? "Enter a valid name and slug.",
          },
        },
        { status: 422 },
      );
    }
    const application = await createApplication(parsed.data);
    return NextResponse.json(application, { status: 201 });
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

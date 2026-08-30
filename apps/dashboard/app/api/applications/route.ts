import { createApplicationRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { createApplication } from "@/lib/server/applications-client";
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

/**
 * Create an application (ADR-0004). Owner/admin only; the tenant is the session's workspace, never
 * client-supplied. `applications:write` is also enforced downstream in the tenant-token client — the
 * role gate here is for a clear 403 before the API round-trip.
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
  if (session.role !== "owner" && session.role !== "admin") {
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins can create applications.",
    );
  }
  try {
    const parsed = createApplicationRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Enter a valid name and slug.",
      );
    }
    const application = await createApplication(parsed.data);
    return NextResponse.json(application, { status: 201 });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

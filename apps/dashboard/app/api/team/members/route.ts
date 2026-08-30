import { inviteMemberRequestSchema } from "@app/contracts";
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
import { inviteMember } from "@/lib/server/members-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Invite a teammate. Owner/admin only; the tenant id is the session's org, never client-supplied. */
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
      "Only owners and admins can invite members.",
    );
  }
  try {
    const parsed = inviteMemberRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_request",
        "Enter a valid email and role.",
      );
    }
    const member = await inviteMember(
      session.orgId,
      parsed.data,
      session.email ?? null,
    );
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

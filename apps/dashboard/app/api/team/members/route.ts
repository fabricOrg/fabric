import { inviteMemberRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { inviteMember } from "@/lib/server/members-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Invite a teammate. Owner/admin only; the tenant id is the session's org, never client-supplied. */
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
      "Only owners and admins can invite members.",
      403,
    );
  }
  try {
    const parsed = inviteMemberRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message: "Enter a valid email and role.",
          },
        },
        { status: 422 },
      );
    }
    const member = await inviteMember(session.orgId, parsed.data);
    return NextResponse.json(member, { status: 201 });
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

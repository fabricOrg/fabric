import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { archiveMessageDefinition } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Archive a definition (soft). Owner/admin only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return authError("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return authError("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("definitions:write")) {
    return authError(
      "insufficient_permission",
      "You do not have permission to archive message definitions.",
      403,
    );
  }
  try {
    const { id } = await params;
    await archiveMessageDefinition(id);
    return NextResponse.json({ archived: true });
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

function authError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}

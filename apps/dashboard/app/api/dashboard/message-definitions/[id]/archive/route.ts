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
} from "@/lib/server/bff-error";
import { archiveMessageDefinition } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Archive a definition (soft). Owner/admin only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.permissions.includes("definitions:write")) {
    return bffForbidden(
      "insufficient_permission",
      "You do not have permission to archive message definitions.",
    );
  }
  try {
    const { id } = await params;
    await archiveMessageDefinition(id);
    return NextResponse.json({ archived: true });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

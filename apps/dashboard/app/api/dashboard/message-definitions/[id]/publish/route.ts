import { publishMessageDefinitionRequest } from "@app/contracts";
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
import { publishMessageDefinition } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Publish a definition version to sandbox. Owner/admin only. */
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
  if (!session.permissions.includes("definitions:publish")) {
    return bffForbidden(
      "insufficient_permission",
      "You do not have permission to publish message definitions.",
    );
  }
  try {
    const { id } = await params;
    const parsed = publishMessageDefinitionRequest.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Invalid publish.",
      );
    }
    return NextResponse.json(await publishMessageDefinition(id, parsed.data));
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

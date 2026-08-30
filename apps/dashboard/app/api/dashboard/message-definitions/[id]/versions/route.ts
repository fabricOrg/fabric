import { addMessageDefinitionVersionRequest } from "@app/contracts";
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
import { addMessageDefinitionVersion } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
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
      "You do not have permission to author message definitions.",
    );
  }
  const parsed = addMessageDefinitionVersionRequest.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid definition version.",
    );
  }
  try {
    const { id } = await context.params;
    return NextResponse.json(
      await addMessageDefinitionVersion(id, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

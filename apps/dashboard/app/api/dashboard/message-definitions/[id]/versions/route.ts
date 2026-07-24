import { addMessageDefinitionVersionRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { addMessageDefinitionVersion } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return errorResponse("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return errorResponse("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("definitions:write")) {
    return errorResponse(
      "insufficient_permission",
      "You do not have permission to author message definitions.",
      403,
    );
  }
  const parsed = addMessageDefinitionVersionRequest.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid definition version.",
      422,
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
      : errorResponse("bff_error", "Request failed.", 500);
  }
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "api_error", code, message } },
    { status },
  );
}

import { publishMessageDefinitionRequest } from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { publishMessageDefinition } from "@/lib/server/message-definitions-client";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Publish a definition version to sandbox. Owner/admin only. */
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
  if (!session.permissions.includes("definitions:publish")) {
    return authError(
      "insufficient_permission",
      "You do not have permission to publish message definitions.",
      403,
    );
  }
  try {
    const { id } = await params;
    const parsed = publishMessageDefinitionRequest.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            type: "validation_error",
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "Invalid publish.",
          },
        },
        { status: 422 },
      );
    }
    return NextResponse.json(await publishMessageDefinition(id, parsed.data));
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

import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { revokeApiKey } from "@/lib/server/api-keys-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Revoke an API key. `api_keys:write` only; tenant from the session, key id from the path. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasTrustedOrigin(request)) {
    return unauthorized("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return unauthorized("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("api_keys:write")) {
    return unauthorized(
      "insufficient_permission",
      "You don't have permission to revoke API keys.",
      403,
    );
  }
  try {
    const { id } = await params;
    await revokeApiKey(id);
    return NextResponse.json({ revoked: true });
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

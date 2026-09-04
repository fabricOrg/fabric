import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { revokeApiKey } from "@/lib/server/api-keys-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Revoke an API key. `api_keys:write` only; tenant from the session, key id from the path. */
export async function DELETE(
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
  if (!session.permissions.includes("api_keys:write")) {
    return bffForbidden(
      "insufficient_permission",
      "You don't have permission to revoke API keys.",
    );
  }
  try {
    const { id } = await params;
    await revokeApiKey(id);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

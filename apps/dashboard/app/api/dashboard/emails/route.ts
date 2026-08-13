import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { listEmails } from "@/lib/server/emails-client";

/** Email inbox for the session's current environment (plan → sandbox|live). Gated on email:read. */
export async function GET(request?: Request) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) return authError("invalid_session", "Sign in again.", 401);
  if (!session.permissions.includes("email:read")) {
    return authError(
      "insufficient_permission",
      "You don't have access to emails.",
      403,
    );
  }
  const env = session.plan === "sandbox" ? "sandbox" : "live";
  const searchParams = request
    ? new URL(request.url).searchParams
    : new URLSearchParams();
  try {
    return NextResponse.json(
      await listEmails(session.orgId, env, {
        ...(searchParams.get("limit")
          ? { limit: searchParams.get("limit") ?? undefined }
          : {}),
        ...(searchParams.get("cursor")
          ? { cursor: searchParams.get("cursor") ?? undefined }
          : {}),
        ...(searchParams.get("status")
          ? { status: searchParams.get("status") ?? undefined }
          : {}),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}

function authError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );
}

function bffError(error: unknown) {
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

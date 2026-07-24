import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { getEmailContent } from "@/lib/server/emails-client";

/** Decrypted content for one email in the session's environment. Gated on email:read. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  try {
    return NextResponse.json(await getEmailContent(session.orgId, env, id));
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

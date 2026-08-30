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
import { getEmailContent } from "@/lib/server/emails-client";

/** Decrypted content for one email in the session's environment. Gated on email:read. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) return bffUnauthorized("invalid_session", "Sign in again.");
  if (!session.permissions.includes("email:read")) {
    return bffForbidden(
      "insufficient_permission",
      "You don't have access to emails.",
    );
  }
  const env = session.plan === "sandbox" ? "sandbox" : "live";
  try {
    return NextResponse.json(await getEmailContent(session.orgId, env, id));
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

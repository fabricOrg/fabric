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
import { listRequestLogs } from "@/lib/server/request-logs-client";

/**
 * Request-logs pagination (W-B). GET (read-only) for the Logs tab's "Load more": the first page is
 * SSR'd on the app-detail page; this returns older pages by cursor. `request_logs:read` gated; tenant
 * from the session.
 */
export async function GET(request: Request) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.permissions.includes("request_logs:read")) {
    return bffForbidden(
      "insufficient_permission",
      "You don't have permission to view request logs.",
    );
  }
  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId");
  const env = url.searchParams.get("env");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!applicationId || (env !== "sandbox" && env !== "live")) {
    return bffUnprocessable(
      "invalid_request",
      "An application and environment are required.",
    );
  }
  try {
    const page = await listRequestLogs(applicationId, env, cursor);
    return NextResponse.json(page);
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

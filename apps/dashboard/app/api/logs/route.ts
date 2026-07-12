import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
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
    return unauthorized("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.permissions.includes("request_logs:read")) {
    return unauthorized(
      "insufficient_permission",
      "You don't have permission to view request logs.",
      403,
    );
  }
  const url = new URL(request.url);
  const applicationId = url.searchParams.get("applicationId");
  const env = url.searchParams.get("env");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!applicationId || (env !== "sandbox" && env !== "live")) {
    return NextResponse.json(
      {
        error: {
          type: "validation_error",
          code: "invalid_request",
          message: "An application and environment are required.",
        },
      },
      { status: 422 },
    );
  }
  try {
    const page = await listRequestLogs(applicationId, env, cursor);
    return NextResponse.json(page);
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

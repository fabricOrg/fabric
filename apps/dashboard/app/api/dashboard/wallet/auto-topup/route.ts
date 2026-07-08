import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Auto top-up config. PUT saves the tenant's threshold/amount/enabled; the API rejects `enabled`
 * without a reusable card on file. Same session-gated BFF pattern as the top-up route — the client
 * never talks to the API directly, and the api key + actor stay server-side.
 */
export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return fail("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return fail("invalid_session", "Sign in again to continue.", 401);
  }
  try {
    const input = (await request.json()) as {
      enabled?: unknown;
      threshold_minor?: unknown;
      top_up_minor?: unknown;
      currency?: unknown;
    };
    return NextResponse.json(
      await dashboardApi("/v1/wallet/auto-topup", "wallet:read", {
        method: "PUT",
        body: JSON.stringify({
          enabled: input.enabled,
          threshold_minor: input.threshold_minor,
          top_up_minor: input.top_up_minor,
          currency: input.currency,
        }),
      }),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail("bff_error", "Request failed.", 500, "api_error");
  }
}

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

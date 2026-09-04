import {
  autoTopupResponseSchema,
  updateAutoTopupRequestSchema,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
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

/**
 * Auto top-up config. PUT saves the tenant's threshold/amount/enabled; the API rejects `enabled`
 * without a reusable card on file. Same session-gated BFF pattern as the top-up route — the client
 * never talks to the API directly, and the api key + actor stay server-side.
 */
export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  try {
    const input = updateAutoTopupRequestSchema.parse(await request.json());
    return NextResponse.json(
      autoTopupResponseSchema.parse(
        await dashboardApi("/v1/wallet/auto-topup", "wallet:read", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      ),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

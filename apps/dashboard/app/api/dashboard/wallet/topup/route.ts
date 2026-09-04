import {
  initiateTopUpRequestSchema,
  initiateTopUpResponseSchema,
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
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Wallet top-up initiation. Returns the provider's hosted-checkout URL for the client to redirect
 * to. The payer email comes from the authenticated session — never the client.
 */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.email) {
    return bffUnprocessable(
      "no_email",
      "Your account has no email for the payment.",
    );
  }
  try {
    const raw = await request.json();
    const input = initiateTopUpRequestSchema.parse({
      ...(typeof raw === "object" && raw !== null ? raw : {}),
      email: session.email,
    });
    return NextResponse.json(
      initiateTopUpResponseSchema.parse(
        await dashboardApi("/v1/wallet/topup", "wallet:read", {
          method: "POST",
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

import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Wallet top-up initiation. Returns the provider's hosted-checkout URL for the client to redirect
 * to. The payer email comes from the authenticated session — never the client.
 */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return fail("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return fail("invalid_session", "Sign in again to continue.", 401);
  }
  if (!session.email) {
    return fail(
      "no_email",
      "Your account has no email for the payment.",
      422,
      "validation_error",
    );
  }
  try {
    const input = (await request.json()) as {
      amount_minor?: unknown;
      currency?: unknown;
    };
    return NextResponse.json(
      await dashboardApi("/v1/wallet/topup", "wallet:read", {
        method: "POST",
        body: JSON.stringify({
          amount_minor: input.amount_minor,
          currency: input.currency,
          email: session.email,
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

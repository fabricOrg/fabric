import {
  purchaseCommercialOfferClientRequestSchema,
  purchaseCommercialOfferResponseSchema,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import { API_EXTERNAL_WRITE_TIMEOUT_MS } from "@/lib/server/api-fetch";
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

/** Starts hosted checkout without accepting tenant or payer identity from the browser. */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (session.plan === "sandbox") {
    return bffForbidden(
      "sandbox_purchase_denied",
      "Sandbox workspaces use daily allowances and cannot purchase tokens.",
    );
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins can purchase token packs.",
    );
  }
  if (!session.email) {
    return bffUnprocessable(
      "no_email",
      "Your account has no email for the payment.",
    );
  }

  try {
    const parsed = purchaseCommercialOfferClientRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return bffUnprocessable(
        "invalid_token_purchase",
        parsed.error.issues[0]?.message ?? "Choose a valid offer and quantity.",
      );
    }
    return NextResponse.json(
      purchaseCommercialOfferResponseSchema.parse(
        await dashboardApi(
          "/v1/tokens/purchase",
          "wallet:read",
          {
            method: "POST",
            body: JSON.stringify({ ...parsed.data, email: session.email }),
          },
          // Same as the wallet top-up: initialises a Paystack checkout, not idempotent, no
          // Idempotency-Key. A short deadline here turns one purchase into two.
          API_EXTERNAL_WRITE_TIMEOUT_MS,
        ),
      ),
    );
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}

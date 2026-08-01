import {
  purchaseCommercialOfferClientRequestSchema,
  purchaseCommercialOfferResponseSchema,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError, dashboardApi } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

/** Starts hosted checkout without accepting tenant or payer identity from the browser. */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return fail("invalid_origin", "Request rejected.", 403);
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return fail("invalid_session", "Sign in again to continue.", 401);
  }
  if (session.plan === "sandbox") {
    return fail(
      "sandbox_purchase_denied",
      "Sandbox workspaces use daily allowances and cannot purchase tokens.",
      403,
    );
  }
  if (session.role !== "owner" && session.role !== "admin") {
    return fail(
      "insufficient_permission",
      "Only owners and admins can purchase token packs.",
      403,
    );
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
    const parsed = purchaseCommercialOfferClientRequestSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return fail(
        "invalid_token_purchase",
        parsed.error.issues[0]?.message ?? "Choose a valid offer and quantity.",
        422,
        "validation_error",
      );
    }
    return NextResponse.json(
      purchaseCommercialOfferResponseSchema.parse(
        await dashboardApi("/v1/tokens/purchase", "wallet:read", {
          method: "POST",
          body: JSON.stringify({ ...parsed.data, email: session.email }),
        }),
      ),
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

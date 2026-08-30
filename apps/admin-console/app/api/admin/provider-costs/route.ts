import { providerCostRateInputSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  listProviderCostRates,
  PriceBookApiError,
  publishProviderCostRate,
} from "@/lib/server/price-book-client";

export async function GET() {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  try {
    return NextResponse.json({ rates: await listProviderCostRates() });
  } catch (error) {
    return error instanceof PriceBookApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "pricing_unavailable",
          "Pricing service is unavailable.",
          502,
        );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Staff admin access is required.",
    );
  }
  const parsed = providerCostRateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_provider_cost",
      "Provider cost details are invalid.",
    );
  }
  try {
    return NextResponse.json(
      await publishProviderCostRate(parsed.data, {
        email: session.email ?? "unknown",
        staffId: session.userId,
      }),
    );
  } catch (error) {
    return error instanceof PriceBookApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "pricing_unavailable",
          "Pricing service is unavailable.",
          502,
        );
  }
}

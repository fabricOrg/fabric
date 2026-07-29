import { providerCostRateInputSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  listProviderCostRates,
  PriceBookApiError,
  publishProviderCostRate,
} from "@/lib/server/price-book-client";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET() {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  try {
    return NextResponse.json({ rates: await listProviderCostRates() });
  } catch (error) {
    return error instanceof PriceBookApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail("pricing_unavailable", "Pricing service is unavailable.", 502);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Staff admin access is required.",
      403,
    );
  }
  const parsed = providerCostRateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return fail(
      "invalid_provider_cost",
      "Provider cost details are invalid.",
      422,
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
      : fail("pricing_unavailable", "Pricing service is unavailable.", 502);
  }
}

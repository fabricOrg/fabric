import { upsertPriceBookRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  PriceBookApiError,
  updatePriceBook,
} from "@/lib/server/price-book-client";

/** Update a price book (replaces its rate set). staff:write only; audited. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can edit pricing.",
    );
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = upsertPriceBookRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Forward the ACTUAL issue. The generic line named three things the operator had already filled
    // in, which is worse than silence: the real failure is usually the publish rule (a published
    // currency needs both SMS and email), and the form's own enable-check does not model it.
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ??
        "Provide a name, mode, and at least one rate.",
    );
  }
  try {
    const updated = await updatePriceBook(id, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(updated);
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

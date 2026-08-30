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
  createPriceBook,
  listPriceBooks,
  PriceBookApiError,
} from "@/lib/server/price-book-client";

/** List all price books. Any staff session may view. */
export async function GET() {
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  try {
    return NextResponse.json(await listPriceBooks());
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

/** Create a price book. staff:write only; the actor is recorded to the audit log. */
export async function POST(request: NextRequest) {
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
    const created = await createPriceBook(parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(created);
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

import { assignPriceBookRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  assignPriceBook,
  PriceBookApiError,
} from "@/lib/server/price-book-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Assign (or clear → default) a tenant's price book. staff:write only; audited. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can edit pricing.",
      403,
    );
  }
  const { accountId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = assignPriceBookRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Provide a price_book_id or null.",
      422,
      "validation_error",
    );
  }
  try {
    await assignPriceBook(accountId, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return error instanceof PriceBookApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail(
          "pricing_unavailable",
          "Pricing service is unavailable.",
          502,
          "api_error",
        );
  }
}

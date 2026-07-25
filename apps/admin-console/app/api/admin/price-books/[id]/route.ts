import { upsertPriceBookRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  PriceBookApiError,
  updatePriceBook,
} from "@/lib/server/price-book-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Update a price book (replaces its rate set). staff:write only; audited. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = upsertPriceBookRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Provide a name, mode, and at least one rate.",
      422,
      "validation_error",
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
      : fail(
          "pricing_unavailable",
          "Pricing service is unavailable.",
          502,
          "api_error",
        );
  }
}

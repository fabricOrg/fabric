import { upsertPriceBookRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import {
  createPriceBook,
  listPriceBooks,
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

/** List all price books. Any staff session may view. */
export async function GET() {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  try {
    return NextResponse.json(await listPriceBooks());
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

/** Create a price book. staff:write only; the actor is recorded to the audit log. */
export async function POST(request: NextRequest) {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = upsertPriceBookRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Forward the ACTUAL issue. The generic line named three things the operator had already filled
    // in, which is worse than silence: the real failure is usually the publish rule (a published
    // currency needs both SMS and email), and the form's own enable-check does not model it.
    return fail(
      "invalid_request",
      parsed.error.issues[0]?.message ??
        "Provide a name, mode, and at least one rate.",
      422,
      "validation_error",
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
      : fail(
          "pricing_unavailable",
          "Pricing service is unavailable.",
          502,
          "api_error",
        );
  }
}

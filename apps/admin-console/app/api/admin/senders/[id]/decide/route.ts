import { decideSenderRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import { decideSender, SenderApiError } from "@/lib/server/senders-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

export async function POST(
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
      "Only staff admins can decide sender registrations.",
      403,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = decideSenderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Decision must be active or rejected (reason ≤ 500 chars).",
      422,
      "validation_error",
    );
  }
  const { id } = await params;
  try {
    const decided = await decideSender(id, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(decided);
  } catch (error) {
    return error instanceof SenderApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : fail(
          "senders_unavailable",
          "Senders service is unavailable.",
          502,
          "api_error",
        );
  }
}

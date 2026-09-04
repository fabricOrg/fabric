import { decideSenderRequestSchema } from "@app/contracts";
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
import { decideSender, SenderApiError } from "@/lib/server/senders-client";

export async function POST(
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
      "Only staff admins can decide sender registrations.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = decideSenderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Decision must be active or rejected (reason ≤ 500 chars).",
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
      : bffFailure(
          "senders_unavailable",
          "Senders service is unavailable.",
          502,
        );
  }
}

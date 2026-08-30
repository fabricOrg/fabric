import { setSenderCarrierStatusRequestSchema } from "@app/contracts";
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
  SenderApiError,
  setSenderCarrierStatus,
} from "@/lib/server/senders-client";

/**
 * Record the CARRIER's outcome for a sender registration. Staff-only — this vocabulary never
 * reaches a customer, who sees only pending → active/rejected.
 */

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
      "Only staff admins can record carrier approval.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = setSenderCarrierStatusRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "The carrier status is invalid.",
    );
  }
  const { id } = await params;
  try {
    const updated = await setSenderCarrierStatus(id, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(updated);
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

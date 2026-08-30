import { decideProposalRequestSchema } from "@app/contracts";
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
  decideProposal,
  ProposalApiError,
} from "@/lib/server/proposals-client";

/** Approve/reject a proposal. staff:write only; the api enforces maker ≠ checker + audits. */
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
      "Only staff admins can decide proposals.",
    );
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = decideProposalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable("invalid_request", "Invalid decision.");
  }
  try {
    const updated = await decideProposal(id, parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return error instanceof ProposalApiError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure(
          "proposals_unavailable",
          "Proposals service is unavailable.",
          502,
        );
  }
}

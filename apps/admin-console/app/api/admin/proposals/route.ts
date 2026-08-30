import { createProposalRequestSchema } from "@app/contracts";
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
  createProposal,
  listProposals,
  ProposalApiError,
} from "@/lib/server/proposals-client";

function errorResponse(error: unknown) {
  return error instanceof ProposalApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure(
        "proposals_unavailable",
        "Proposals service is unavailable.",
        502,
      );
}

export async function GET() {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  try {
    return NextResponse.json(await listProposals());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  const session = await readAdminSessionWithRefresh();
  if (!session)
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  if (!session.permissions.includes("staff:write")) {
    return bffForbidden(
      "insufficient_permission",
      "Only staff admins can propose changes.",
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed body.");
  }
  const parsed = createProposalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return bffUnprocessable(
      "invalid_request",
      "Fill in all fields (reason ≥ 8 chars).",
    );
  }
  try {
    const created = await createProposal(parsed.data, {
      email: session.email ?? "unknown",
      staffId: session.userId,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

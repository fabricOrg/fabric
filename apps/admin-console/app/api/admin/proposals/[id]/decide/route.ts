import { decideProposalRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "@/lib/server/auth";
import {
  decideProposal,
  ProposalApiError,
} from "@/lib/server/proposals-client";

function fail(
  code: string,
  message: string,
  status: number,
  type = "auth_error",
) {
  return NextResponse.json({ error: { type, code, message } }, { status });
}

/** Approve/reject a proposal. staff:write only; the api enforces maker ≠ checker + audits. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readAdminSession();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can decide proposals.",
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
  const parsed = decideProposalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Invalid decision.",
      422,
      "validation_error",
    );
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
      : fail(
          "proposals_unavailable",
          "Proposals service is unavailable.",
          502,
          "api_error",
        );
  }
}

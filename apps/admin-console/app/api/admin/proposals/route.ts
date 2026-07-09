import { createProposalRequestSchema } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  createProposal,
  listProposals,
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

function errorResponse(error: unknown) {
  return error instanceof ProposalApiError
    ? NextResponse.json(error.payload, { status: error.status })
    : fail(
        "proposals_unavailable",
        "Proposals service is unavailable.",
        502,
        "api_error",
      );
}

export async function GET() {
  if (!(await readAdminSessionWithRefresh())) {
    return fail("invalid_session", "Staff sign-in required.", 401);
  }
  try {
    return NextResponse.json(await listProposals());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await readAdminSessionWithRefresh();
  if (!session) return fail("invalid_session", "Staff sign-in required.", 401);
  if (!session.permissions.includes("staff:write")) {
    return fail(
      "insufficient_permission",
      "Only staff admins can propose changes.",
      403,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Malformed body.", 400, "validation_error");
  }
  const parsed = createProposalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      "invalid_request",
      "Fill in all fields (reason ≥ 8 chars).",
      422,
      "validation_error",
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

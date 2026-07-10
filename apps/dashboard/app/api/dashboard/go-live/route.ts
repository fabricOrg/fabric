// Go-live BFF (ADR-0002 F4). GET = the tenant's latest request status; POST = submit a request.
// The tenant id and requester email come from the AUTHENTICATED SESSION — never the client body —
// and ride to the api as x-tenant-id / x-actor-email under the BFF service token.

import { goLiveRequestSchema } from "@app/contracts";
import { NextResponse } from "next/server";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/origin";

function backend(): { baseUrl: string; bffToken: string } {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

async function sessionOr401() {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) return null;
  return session;
}

const denied = (code: string, message: string, status: number) =>
  NextResponse.json(
    { error: { type: "auth_error", code, message } },
    { status },
  );

export async function GET() {
  const session = await sessionOr401();
  if (!session) return denied("invalid_session", "Sign in to continue.", 401);
  const { baseUrl, bffToken } = backend();
  const response = await fetch(
    new URL("/internal/admin/proposals/go-live/status", baseUrl),
    {
      cache: "no-store",
      headers: { "x-bff-token": bffToken, "x-tenant-id": session.orgId },
    },
  );
  return NextResponse.json(await response.json(), {
    status: response.status,
  });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return denied("invalid_origin", "Request rejected.", 403);
  }
  const session = await sessionOr401();
  if (!session) return denied("invalid_session", "Sign in to continue.", 401);
  // Going live is an org decision — owners/admins only, not members/developers.
  if (session.role !== "owner" && session.role !== "admin") {
    return denied(
      "insufficient_permission",
      "Only an owner or admin can request go-live.",
      403,
    );
  }
  const parsed = goLiveRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          type: "invalid_request_error",
          code: "invalid_go_live_request",
          message: parsed.error.issues[0]?.message ?? "The request is invalid.",
        },
      },
      { status: 400 },
    );
  }
  const { baseUrl, bffToken } = backend();
  const response = await fetch(
    new URL("/internal/admin/proposals/go-live", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        "x-tenant-id": session.orgId,
        "x-actor-email": session.email ?? "unknown@tenant",
      },
      body: JSON.stringify(parsed.data),
    },
  );
  return NextResponse.json(await response.json(), {
    status: response.status,
  });
}

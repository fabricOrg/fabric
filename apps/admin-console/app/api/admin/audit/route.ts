import { type NextRequest, NextResponse } from "next/server";
import { AuditApiError, listAudit } from "@/lib/server/audit-client";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";

/**
 * Audit-log page fetch (finding A3). The first page is server-rendered by the page; this
 * staff-gated GET serves subsequent keyset pages for the "Load more" control (a read, so no
 * origin/CSRF gate — that guards mutations). Passes the opaque cursor straight through.
 */
export async function GET(request: NextRequest) {
  if (!(await readAdminSessionWithRefresh())) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_session",
          message: "Staff sign-in required.",
        },
      },
      { status: 401 },
    );
  }
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    return NextResponse.json(await listAudit(cursor ? { cursor } : {}));
  } catch (error) {
    const status = error instanceof AuditApiError ? error.status : 502;
    return NextResponse.json(
      {
        error: {
          type: "api_error",
          code: "audit_unavailable",
          message: "Audit log is unavailable right now.",
        },
      },
      { status },
    );
  }
}

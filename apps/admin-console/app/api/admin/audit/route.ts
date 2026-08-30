import { type NextRequest, NextResponse } from "next/server";
import { AuditApiError, listAudit } from "@/lib/server/audit-client";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { bffFailure, bffUnauthorized } from "@/lib/server/bff-error";

/**
 * Audit-log page fetch (finding A3). The first page is server-rendered by the page; this
 * staff-gated GET serves subsequent keyset pages for the "Load more" control (a read, so no
 * origin/CSRF gate — that guards mutations). Passes the opaque cursor straight through.
 */
export async function GET(request: NextRequest) {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    return NextResponse.json(await listAudit(cursor ? { cursor } : {}));
  } catch (error) {
    const status = error instanceof AuditApiError ? error.status : 502;
    return bffFailure(
      "audit_unavailable",
      "Audit log is unavailable right now.",
      status,
    );
  }
}

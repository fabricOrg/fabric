import { apiErrorEnvelope, virtualPhoneReply } from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffInvalidRequest,
  bffUnauthorized,
} from "@/lib/server/bff-error";
import {
  clearVirtualPhoneInbox,
  getVirtualPhoneInbox,
  sendVirtualPhoneReply,
} from "@/lib/server/virtual-phone-client";

/**
 * Forward an upstream failure, guaranteeing a PARSEABLE envelope. An api error that escaped
 * unstructured (a bare throw → Nest's `{statusCode, message}`) used to be proxied verbatim, so the
 * dashboard found no message and fell back to a generic one — which is how a failed reply came to
 * report "Virtual phone data could not be loaded."
 *
 * The upstream envelope is passed through only when it carries a `type`, because that is what
 * `parseApiError` requires; a partial one is replaced rather than forwarded, since forwarding it
 * loses the fallback message too.
 */
function failure(error: unknown, fallback: string) {
  if (error instanceof BffError) {
    const parsed = apiErrorEnvelope.safeParse(error.payload);
    if (parsed.success) {
      return NextResponse.json(parsed.data, { status: error.status });
    }
    return bffFailure("virtual_phone_unavailable", fallback, error.status);
  }
  return bffFailure("virtual_phone_unavailable", fallback);
}

export async function GET(request: NextRequest) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  if (!session.permissions.includes("sms:read")) {
    return bffForbidden(
      "insufficient_permission",
      "Your role cannot read message content.",
    );
  }
  try {
    const inbox = await getVirtualPhoneInbox(
      session.orgId,
      request.nextUrl.searchParams.get("cursor") ?? undefined,
      request.nextUrl.searchParams.get("recipient") ?? undefined,
    );
    return NextResponse.json({
      ...inbox,
      can_clear: session.role === "owner" || session.role === "admin",
    });
  } catch (error) {
    return failure(error, "Virtual phone data could not be loaded.");
  }
}

export async function DELETE() {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  if (session.role !== "owner" && session.role !== "admin") {
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins can clear this inbox.",
    );
  }
  try {
    return NextResponse.json({
      cleared: await clearVirtualPhoneInbox(
        session.orgId,
        session.email ?? undefined,
      ),
    });
  } catch (error) {
    return failure(error, "The inbox could not be cleared.");
  }
}

export async function POST(request: NextRequest) {
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session)
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  if (!session.permissions.includes("sms:send")) {
    return bffForbidden(
      "insufficient_permission",
      "Your role cannot send virtual replies.",
    );
  }
  const parsed = virtualPhoneReply.safeParse(await request.json());
  if (!parsed.success) {
    return bffInvalidRequest(
      "invalid_reply",
      parsed.error.issues[0]?.message ?? "Invalid reply.",
    );
  }
  try {
    return NextResponse.json(
      await sendVirtualPhoneReply(session.orgId, parsed.data),
    );
  } catch (error) {
    return failure(error, "The reply could not be sent.");
  }
}

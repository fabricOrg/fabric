import { updateMessagingSettingsRequest } from "@app/contracts";
import { NextResponse } from "next/server";
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
import { hasTrustedOrigin } from "@/lib/server/origin";
import {
  getMessagingSettings,
  setMessagingMode,
} from "@/lib/server/virtual-phone-client";

async function session() {
  return (await readDashboardSession()) ?? (await refreshDashboardSession());
}

export async function GET() {
  const current = await session();
  if (!current)
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  try {
    return NextResponse.json(await getMessagingSettings(current.orgId));
  } catch (error) {
    return respond(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const current = await session();
  if (!current)
    return bffUnauthorized("invalid_session", "Sign in to continue.");
  if (current.role !== "owner" && current.role !== "admin") {
    // `insufficient_permission` is read by the caller: delivery-mode-toggle.tsx maps a code to a heading
    // and a next step, and an unrecognised one falls through to a generic toast. A message with no
    // code reaches the user as "Something went wrong" — the refusal's whole point, discarded.
    return bffForbidden(
      "insufficient_permission",
      "Only owners and admins can change delivery mode.",
    );
  }
  // The SAME contract the API publishes and parses, rather than a third local copy of the shape.
  // Casting the body and picking one field off it is exactly how the API's binding and handler
  // drifted until the published body said `"virtual"` and every caller sent `{ delivery_mode }`.
  const parsed = updateMessagingSettingsRequest.safeParse(await request.json());
  if (!parsed.success)
    return bffInvalidRequest(
      "invalid_delivery_mode",
      "Invalid delivery mode.",
      "delivery_mode",
    );
  try {
    return NextResponse.json(
      await setMessagingMode(
        current.orgId,
        parsed.data.delivery_mode,
        current.email,
      ),
    );
  } catch (error) {
    return respond(error);
  }
}

function respond(error: unknown) {
  // A forwarded API failure keeps its own envelope, `request_id` included — re-wrapping it here
  // would replace a traceable upstream error with a local one.
  return error instanceof BffError
    ? NextResponse.json(error.payload, { status: error.status })
    : bffFailure("bff_error", "Request failed.");
}

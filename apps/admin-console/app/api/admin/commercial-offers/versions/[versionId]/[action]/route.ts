import {
  publishCommercialOfferVersionRequestSchema,
  retireCommercialOfferVersionRequestSchema,
} from "@app/contracts";
import type { NextRequest } from "next/server";
import { bffNotFound } from "@/lib/server/bff-error";
import {
  cloneOfferVersion,
  publishOfferVersion,
  retireOfferVersion,
} from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

/**
 * The three lifecycle actions on a version. One route with an ALLOWLISTED action, rather than three
 * files repeating the same session gate — an unknown action is refused before any work happens.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string; action: string }> },
) {
  const { versionId, action } = await params;

  if (action === "clone") {
    return withStaffWrite(request, null, (actor) =>
      cloneOfferVersion(versionId, actor),
    );
  }
  if (action === "publish") {
    return withStaffWrite(
      request,
      publishCommercialOfferVersionRequestSchema,
      (actor, body) => publishOfferVersion(versionId, body, actor),
    );
  }
  if (action === "retire") {
    return withStaffWrite(
      request,
      retireCommercialOfferVersionRequestSchema,
      (actor, body) => retireOfferVersion(versionId, body, actor),
    );
  }
  return bffNotFound("unknown_action", "Expected clone, publish, or retire.");
}

import { updateCommercialOfferVersionRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import { updateOfferVersion } from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

/** Edit a draft's terms. The api refuses this once a version is published — clone it instead. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params;
  return withStaffWrite(
    request,
    updateCommercialOfferVersionRequestSchema,
    (actor, body) => updateOfferVersion(versionId, body, actor),
  );
}

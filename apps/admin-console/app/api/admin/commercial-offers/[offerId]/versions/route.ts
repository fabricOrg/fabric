import { createCommercialOfferVersionRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import { createOfferVersion } from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

/** Author a new DRAFT version of an offer's terms. Publication is a separate, two-actor step. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  return withStaffWrite(
    request,
    createCommercialOfferVersionRequestSchema,
    (actor, body) => createOfferVersion(offerId, body, actor),
  );
}

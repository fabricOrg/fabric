import { previewCommercialOfferMarginRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import { previewOfferMargin } from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

/**
 * The margin verdict for terms the form has not saved yet. Guarded like a write even though it changes
 * nothing: it discloses provider cost and margin, which is not information a read-only session needs.
 */
export async function POST(request: NextRequest) {
  return withStaffWrite(
    request,
    previewCommercialOfferMarginRequestSchema,
    (_actor, body) => previewOfferMargin(body),
  );
}

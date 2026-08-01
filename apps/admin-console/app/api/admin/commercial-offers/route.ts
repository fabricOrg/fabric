import { createCommercialOfferRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import {
  createCommercialOffer,
  listCommercialOffers,
} from "@/lib/server/commercial-offers-client";
import { withStaffRead, withStaffWrite } from "@/lib/server/offer-route";

/** Every offer with its version history, plus the channel registry. Any staff session may read. */
export async function GET() {
  return withStaffRead(listCommercialOffers);
}

/** Create an offer's stable identity. Its commercial terms are a separate, versioned call. */
export async function POST(request: NextRequest) {
  return withStaffWrite(
    request,
    createCommercialOfferRequestSchema,
    (actor, body) => createCommercialOffer(body, actor),
  );
}

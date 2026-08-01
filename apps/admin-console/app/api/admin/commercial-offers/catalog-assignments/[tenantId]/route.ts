import { assignOfferCatalogRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import { assignOfferCatalog } from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

/**
 * Point a workspace at a negotiated prepaid catalog, or clear it back to the default (COM-011).
 * Independent of the pay-as-you-go price-book assignment — a bundle catalog and a per-unit rate plan
 * are separate commercial decisions.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  return withStaffWrite(
    request,
    assignOfferCatalogRequestSchema,
    (actor, body) => assignOfferCatalog(tenantId, body, actor),
  );
}

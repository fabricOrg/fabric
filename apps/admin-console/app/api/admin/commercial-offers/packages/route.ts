import { createCommercialPackageRequestSchema } from "@app/contracts";
import type { NextRequest } from "next/server";
import { createCommercialPackage } from "@/lib/server/commercial-offers-client";
import { withStaffWrite } from "@/lib/server/offer-route";

export async function POST(request: NextRequest) {
  return withStaffWrite(
    request,
    createCommercialPackageRequestSchema,
    (actor, body) => createCommercialPackage(body, actor),
  );
}

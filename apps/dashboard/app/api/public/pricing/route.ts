import { NextResponse } from "next/server";
import {
  getPublicPricing,
  PublicPricingApiError,
} from "@/lib/server/public-pricing-client";

const PUBLIC_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
  "x-content-type-options": "nosniff",
} as const;

function unavailable(status: number) {
  return NextResponse.json(
    {
      error: {
        type: "api_error",
        code: "public_pricing_unavailable",
        message: "Published pricing is unavailable.",
      },
    },
    { status, headers: PUBLIC_HEADERS },
  );
}

/**
 * Public, read-only BFF projection. It accepts no book or tenant selector and returns only the
 * allowlisted public-pricing contract, so internal price books and assignments cannot be enumerated.
 */
export async function GET() {
  try {
    return NextResponse.json(await getPublicPricing(), {
      headers: PUBLIC_HEADERS,
    });
  } catch (error) {
    if (error instanceof PublicPricingApiError && error.status === 404) {
      return unavailable(404);
    }
    return unavailable(503);
  }
}

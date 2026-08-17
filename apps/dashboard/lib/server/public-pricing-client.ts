import "server-only";

import {
  type PublicPricingResponse,
  publicPricingResponseSchema,
  unwrapEnvelope,
} from "@app/contracts";

export class PublicPricingApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Public pricing API request failed with status ${status}.`);
  }
}

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

/** Server-only fetch of the narrow published snapshot. No browser receives the BFF secret. */
export async function getPublicPricing(): Promise<PublicPricingResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(new URL("/internal/public/pricing", baseUrl), {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new PublicPricingApiError(response.status, payload);
  }
  return publicPricingResponseSchema.parse(unwrapEnvelope(payload));
}

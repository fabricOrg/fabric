import "server-only";

import {
  type AssignPriceBookRequest,
  type ListPriceBooksResponse,
  listPriceBooksResponseSchema,
  type PriceBookDto,
  priceBookDtoSchema,
  type UpsertPriceBookRequest,
} from "@app/contracts";

/** Price-book control plane via the api's BffToken-guarded /internal/admin/price-books (ADR-0010). */
export class PriceBookApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Price-book API request failed with status ${status}.`);
  }
}

interface Actor {
  readonly email: string;
  readonly staffId: string;
}

function backendConfiguration() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

function actorHeaders(actor: Actor, bffToken: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-bff-token": bffToken,
    "x-actor-email": actor.email,
    "x-actor-staff-id": actor.staffId,
  };
}

export async function listPriceBooks(): Promise<ListPriceBooksResponse> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/admin/price-books", baseUrl),
    {
      cache: "no-store",
      headers: { "x-bff-token": bffToken },
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new PriceBookApiError(response.status, payload);
  return listPriceBooksResponseSchema.parse(payload);
}

export async function createPriceBook(
  request: UpsertPriceBookRequest,
  actor: Actor,
): Promise<PriceBookDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL("/internal/admin/price-books", baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: actorHeaders(actor, bffToken),
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new PriceBookApiError(response.status, payload);
  return priceBookDtoSchema.parse(payload);
}

export async function updatePriceBook(
  id: string,
  request: UpsertPriceBookRequest,
  actor: Actor,
): Promise<PriceBookDto> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(`/internal/admin/price-books/${encodeURIComponent(id)}`, baseUrl),
    {
      method: "PUT",
      cache: "no-store",
      headers: actorHeaders(actor, bffToken),
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new PriceBookApiError(response.status, payload);
  return priceBookDtoSchema.parse(payload);
}

export async function assignPriceBook(
  accountId: string,
  request: AssignPriceBookRequest,
  actor: Actor,
): Promise<void> {
  const { baseUrl, bffToken } = backendConfiguration();
  const response = await fetch(
    new URL(
      `/internal/admin/price-books/assignments/${encodeURIComponent(accountId)}`,
      baseUrl,
    ),
    {
      method: "POST",
      cache: "no-store",
      headers: actorHeaders(actor, bffToken),
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new PriceBookApiError(response.status, payload);
  }
}

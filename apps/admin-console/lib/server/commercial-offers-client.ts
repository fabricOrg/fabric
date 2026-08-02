import "server-only";

import {
  type AssignOfferCatalogRequest,
  type CommercialOfferDto,
  type CommercialOfferMarginPreview,
  type CommercialOfferVersionDto,
  type CreateCommercialOfferRequest,
  type CreateCommercialOfferVersionRequest,
  type CreateCommercialPackageRequest,
  type CreateCommercialPackageResponse,
  commercialOfferDtoSchema,
  commercialOfferMarginPreviewSchema,
  commercialOfferVersionDtoSchema,
  createCommercialPackageResponseSchema,
  type ListCommercialOffersResponse,
  listCommercialOffersResponseSchema,
  type PreviewCommercialOfferMarginRequest,
  type PublishCommercialOfferVersionRequest,
  type RetireCommercialOfferVersionRequest,
} from "@app/contracts";

/**
 * Commercial-offer control plane via the api's BffToken-guarded `/internal/admin/commercial-offers`
 * (ADR-0012). Mirrors `price-book-client.ts`, with one difference that matters: the acting staff
 * identity is REQUIRED on every write, because authorship and approval are the audit record the
 * two-actor publish rule is enforced against.
 */
export class CommercialOfferApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Commercial-offer API request failed with status ${status}.`);
  }
}

export interface Actor {
  readonly email: string;
  readonly staffId: string;
}

function backend() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

async function request<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT"; actor?: Actor; body?: unknown },
  parse: (payload: unknown) => T,
): Promise<T> {
  const { baseUrl, bffToken } = backend();
  const response = await fetch(
    new URL(`/internal/admin/commercial-offers${path}`, baseUrl),
    {
      method: init.method,
      cache: "no-store",
      headers: {
        // Only claim a JSON body when there is one. Fastify refuses an empty body under
        // `content-type: application/json` with FST_ERR_CTP_EMPTY_JSON_BODY — a 400 that made
        // bodyless actions like clone fail, and whose payload has no `error.message` for the UI to
        // show, so it surfaced as a bare "request failed with status 400".
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        "x-bff-token": bffToken,
        ...(init.actor
          ? {
              "x-actor-email": init.actor.email,
              "x-actor-staff-id": init.actor.staffId,
            }
          : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new CommercialOfferApiError(response.status, payload);
  return parse(payload);
}

export function listCommercialOffers(): Promise<ListCommercialOffersResponse> {
  return request("", { method: "GET" }, (payload) =>
    listCommercialOffersResponseSchema.parse(payload),
  );
}

export function createCommercialOffer(
  body: CreateCommercialOfferRequest,
  actor: Actor,
): Promise<CommercialOfferDto> {
  return request("", { method: "POST", actor, body }, (payload) =>
    commercialOfferDtoSchema.parse(payload),
  );
}

export function createCommercialPackage(
  body: CreateCommercialPackageRequest,
  actor: Actor,
): Promise<CreateCommercialPackageResponse> {
  return request("/packages", { method: "POST", actor, body }, (payload) =>
    createCommercialPackageResponseSchema.parse(payload),
  );
}

export function createOfferVersion(
  offerId: string,
  body: CreateCommercialOfferVersionRequest,
  actor: Actor,
): Promise<CommercialOfferVersionDto> {
  return request(
    `/${encodeURIComponent(offerId)}/versions`,
    { method: "POST", actor, body },
    (payload) => commercialOfferVersionDtoSchema.parse(payload),
  );
}

export function updateOfferVersion(
  versionId: string,
  body: CreateCommercialOfferVersionRequest,
  actor: Actor,
): Promise<CommercialOfferVersionDto> {
  return request(
    `/versions/${encodeURIComponent(versionId)}`,
    { method: "PUT", actor, body },
    (payload) => commercialOfferVersionDtoSchema.parse(payload),
  );
}

export function cloneOfferVersion(
  versionId: string,
  actor: Actor,
): Promise<CommercialOfferVersionDto> {
  return request(
    `/versions/${encodeURIComponent(versionId)}/clone`,
    { method: "POST", actor },
    (payload) => commercialOfferVersionDtoSchema.parse(payload),
  );
}

export function publishOfferVersion(
  versionId: string,
  body: PublishCommercialOfferVersionRequest,
  actor: Actor,
): Promise<CommercialOfferVersionDto> {
  return request(
    `/versions/${encodeURIComponent(versionId)}/publish`,
    { method: "POST", actor, body },
    (payload) => commercialOfferVersionDtoSchema.parse(payload),
  );
}

export function retireOfferVersion(
  versionId: string,
  body: RetireCommercialOfferVersionRequest,
  actor: Actor,
): Promise<CommercialOfferVersionDto> {
  return request(
    `/versions/${encodeURIComponent(versionId)}/retire`,
    { method: "POST", actor, body },
    (payload) => commercialOfferVersionDtoSchema.parse(payload),
  );
}

export function previewOfferMargin(
  body: PreviewCommercialOfferMarginRequest,
): Promise<CommercialOfferMarginPreview> {
  return request("/margin-preview", { method: "POST", body }, (payload) =>
    commercialOfferMarginPreviewSchema.parse(payload),
  );
}

export function assignOfferCatalog(
  tenantId: string,
  body: AssignOfferCatalogRequest,
  actor: Actor,
): Promise<{ ok: boolean }> {
  return request(
    `/catalog-assignments/${encodeURIComponent(tenantId)}`,
    { method: "POST", actor, body },
    () => ({ ok: true }),
  );
}

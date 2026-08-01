import {
  type AssignOfferCatalogRequest,
  type CommercialOfferDto,
  type CommercialOfferMarginPreview,
  type CommercialOfferVersionDto,
  type CreateCommercialOfferRequest,
  type CreateCommercialOfferVersionRequest,
  commercialOfferDtoSchema,
  commercialOfferMarginPreviewSchema,
  commercialOfferVersionDtoSchema,
  type PreviewCommercialOfferMarginRequest,
} from "@app/contracts";
import { type ZodType, z } from "zod";

/**
 * Browser-side calls to the admin-console BFF for commercial offers. The BFF passes the api's
 * structured error through unchanged, so `code` here is the api's own stable code and `message` is its
 * own sentence — which is why the toasts show the API's wording rather than a generic failure. Nothing
 * branches on `code` yet; it is preserved so a caller that needs to can, without a server change.
 */

export interface OfferRequestError {
  readonly code: string;
  readonly message: string;
}

export class OfferError extends Error {
  constructor(readonly detail: OfferRequestError) {
    super(detail.message);
    this.name = "OfferError";
  }
}

/**
 * `schema` is not optional decoration: this is a boundary, and the same contract the API produced is
 * what the browser parses. It also rules out the shape `payload as T` would have let through — a 2xx
 * with a non-JSON body yields `null`, which would have reached the UI typed as a DTO and rendered
 * "Draft vundefined created."
 */
async function send<T>(
  path: string,
  method: "POST" | "PUT",
  schema: ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/admin/commercial-offers${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new OfferError({
      code: payload?.error?.code ?? "request_failed",
      // A 5xx from Nest carries no cause; naming the status beats an empty toast.
      message:
        payload?.error?.message ??
        `The request failed with status ${response.status}.`,
    });
  }
  return schema.parse(payload);
}

export function createOffer(
  body: CreateCommercialOfferRequest,
): Promise<CommercialOfferDto> {
  return send("", "POST", commercialOfferDtoSchema, body);
}

export function createVersion(
  offerId: string,
  body: CreateCommercialOfferVersionRequest,
): Promise<CommercialOfferVersionDto> {
  return send(
    `/${encodeURIComponent(offerId)}/versions`,
    "POST",
    commercialOfferVersionDtoSchema,
    body,
  );
}

export function updateVersion(
  versionId: string,
  body: CreateCommercialOfferVersionRequest,
): Promise<CommercialOfferVersionDto> {
  return send(
    `/versions/${encodeURIComponent(versionId)}`,
    "PUT",
    commercialOfferVersionDtoSchema,
    body,
  );
}

export function cloneVersion(
  versionId: string,
): Promise<CommercialOfferVersionDto> {
  return send(
    `/versions/${encodeURIComponent(versionId)}/clone`,
    "POST",
    commercialOfferVersionDtoSchema,
  );
}

export function publishVersion(
  versionId: string,
  reason: string,
): Promise<CommercialOfferVersionDto> {
  return send(
    `/versions/${encodeURIComponent(versionId)}/publish`,
    "POST",
    commercialOfferVersionDtoSchema,
    { reason },
  );
}

export function retireVersion(
  versionId: string,
  reason: string,
): Promise<CommercialOfferVersionDto> {
  return send(
    `/versions/${encodeURIComponent(versionId)}/retire`,
    "POST",
    commercialOfferVersionDtoSchema,
    { reason },
  );
}

export function previewMargin(
  body: PreviewCommercialOfferMarginRequest,
): Promise<CommercialOfferMarginPreview> {
  return send(
    "/margin-preview",
    "POST",
    commercialOfferMarginPreviewSchema,
    body,
  );
}

const okSchema: ZodType<{ ok: boolean }> = z.object({ ok: z.boolean() });

export function assignCatalog(
  tenantId: string,
  body: AssignOfferCatalogRequest,
): Promise<{ ok: boolean }> {
  return send(
    `/catalog-assignments/${encodeURIComponent(tenantId)}`,
    "POST",
    okSchema,
    body,
  );
}

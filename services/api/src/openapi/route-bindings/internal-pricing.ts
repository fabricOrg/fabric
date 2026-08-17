import {
  assignOfferCatalogRequestSchema,
  assignPriceBookRequestSchema,
  commercialOfferDtoSchema,
  commercialOfferMarginPreviewSchema,
  commercialOfferVersionDtoSchema,
  createCommercialOfferRequestSchema,
  createCommercialOfferVersionRequestSchema,
  createCommercialPackageRequestSchema,
  createCommercialPackageResponseSchema,
  erasureRequestSchema,
  erasureResultSchema,
  listCommercialOffersResponseSchema,
  listPriceBooksResponseSchema,
  listProviderCostRatesResponseSchema,
  okAck,
  previewCommercialOfferMarginRequestSchema,
  priceBookDtoSchema,
  providerCostRateDtoSchema,
  providerCostRateInputSchema,
  publishCommercialOfferVersionRequestSchema,
  retireCommercialOfferVersionRequestSchema,
  subjectSummarySchema,
  updateCommercialOfferVersionRequestSchema,
  upsertPriceBookRequestSchema,
  whatsappTemplateSyncResultSchema,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Pricing, provider costs and commercial offers — the staff surface that decides what a send sells
 * for. Split from `internal-admin.ts` to stay under the file-length guard.
 *
 * These routes move money indirectly and are the ones most worth reading carefully: a sell rate
 * below the worst active provider cost is refused at publish time rather than discovered on the
 * first failed send.
 */
export const INTERNAL_PRICING_BINDINGS: RouteBindings = {
  // ---- Pricing -----------------------------------------------------------------------------
  "GET /internal/admin/price-books": {
    summary: "List price books",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listPriceBooksResponseSchema,
  },
  "POST /internal/admin/price-books": {
    summary: "Create a price book",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: upsertPriceBookRequestSchema,
    response: priceBookDtoSchema,
  },
  "PUT /internal/admin/price-books/:id": {
    summary: "Update a price book",
    description:
      "Publishing rejects any rate under the margin floor against the worst active provider cost, " +
      "in-transaction.",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: upsertPriceBookRequestSchema,
    response: priceBookDtoSchema,
  },
  "POST /internal/admin/price-books/assignments/:accountId": {
    summary: "Assign a price book to an account",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: assignPriceBookRequestSchema,
    response: okAck,
  },
  "GET /internal/admin/price-books/provider-costs": {
    summary: "List provider cost rates",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listProviderCostRatesResponseSchema,
  },
  "POST /internal/admin/price-books/provider-costs": {
    summary: "Publish a provider cost rate",
    description:
      "`provider_vendor` must equal the adapter slug exactly (`arkesel-sms`, `meta-cloud`, " +
      "`aws-ses-email`). A friendly label saves, displays as active, and prices nothing.",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: providerCostRateInputSchema,
    response: providerCostRateDtoSchema,
  },

  // ---- Commercial offers -------------------------------------------------------------------
  "GET /internal/admin/commercial-offers": {
    summary: "List commercial offers",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listCommercialOffersResponseSchema,
  },
  "POST /internal/admin/commercial-offers": {
    summary: "Create a commercial offer",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createCommercialOfferRequestSchema,
    response: commercialOfferDtoSchema,
  },
  "POST /internal/admin/commercial-offers/:offerId/versions": {
    summary: "Add an offer version",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createCommercialOfferVersionRequestSchema,
    response: commercialOfferVersionDtoSchema,
  },
  "PUT /internal/admin/commercial-offers/versions/:versionId": {
    summary: "Update an offer version",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: updateCommercialOfferVersionRequestSchema,
    response: commercialOfferVersionDtoSchema,
  },
  "POST /internal/admin/commercial-offers/versions/:versionId/clone": {
    summary: "Clone an offer version",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    response: commercialOfferVersionDtoSchema,
  },
  "POST /internal/admin/commercial-offers/versions/:versionId/publish": {
    summary: "Publish an offer version",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: publishCommercialOfferVersionRequestSchema,
    response: commercialOfferVersionDtoSchema,
  },
  "POST /internal/admin/commercial-offers/versions/:versionId/retire": {
    summary: "Retire an offer version",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: retireCommercialOfferVersionRequestSchema,
    response: commercialOfferVersionDtoSchema,
  },
  "POST /internal/admin/commercial-offers/packages": {
    summary: "Create an offer package",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createCommercialPackageRequestSchema,
    response: createCommercialPackageResponseSchema,
  },
  "POST /internal/admin/commercial-offers/margin-preview": {
    summary: "Preview offer margin",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: previewCommercialOfferMarginRequestSchema,
    response: commercialOfferMarginPreviewSchema,
  },
  "POST /internal/admin/commercial-offers/catalog-assignments/:tenantId": {
    summary: "Assign an offer catalog to a tenant",
    tags: ["Pricing"],
    visibility: "internal",
    security: ["bffInternal"],
    request: assignOfferCatalogRequestSchema,
    response: okAck,
  },

  // ---- Privacy and WhatsApp ops ------------------------------------------------------------
  "GET /internal/admin/privacy/tenants/:tenantId/subject": {
    summary: "Retrieve a data subject's record",
    tags: ["Compliance"],
    visibility: "internal",
    security: ["bffInternal"],
    response: subjectSummarySchema,
  },
  "POST /internal/admin/privacy/tenants/:tenantId/erasures": {
    summary: "Execute a subject erasure",
    description:
      "Crypto-shreds the subject's key. Legally retained records survive by design — the ledger is " +
      "immutable.",
    tags: ["Compliance"],
    visibility: "internal",
    security: ["bffInternal"],
    request: erasureRequestSchema,
    response: erasureResultSchema,
  },
  "POST /internal/admin/whatsapp/template-sync": {
    summary: "Trigger a WhatsApp template sync",
    description:
      "Driven externally on a schedule: the free-tier host sleeps, and a sleeping process runs no " +
      "cron, so the request itself is what wakes the instance.",
    tags: ["WhatsApp"],
    visibility: "internal",
    security: ["bffInternal"],
    response: whatsappTemplateSyncResultSchema,
  },
};

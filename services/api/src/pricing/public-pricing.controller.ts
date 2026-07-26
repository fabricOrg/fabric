import { Controller, Get, Header, Inject } from "@nestjs/common";
import { notFound } from "../http/api-error.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";

/**
 * The one deliberately published price snapshot — UNAUTHENTICATED on purpose.
 *
 * This is the rate card a visitor sees before signing up, so it is public by intent. Guarding it with
 * BFF_INTERNAL_TOKEN would have forced the marketing site to hold a credential able to call
 * `/internal/*` — an internal key on the most exposed surface we run, just to render a price. A
 * public fact belongs behind a public endpoint.
 *
 * Safety comes from the SHAPE, not a secret: the response carries no book identity, no tenant
 * assignment, and no account's negotiated rates — only the sanitized snapshot staff explicitly
 * flagged `is_public`, and the DB CHECK forbids a token-mode book from ever being that one.
 */
@Controller("v1/public/pricing")
export class PublicPricingController {
  constructor(
    @Inject(PriceBookAdminService)
    private readonly pricing: PriceBookAdminService,
  ) {}

  @Get()
  // Cacheable: identical bytes for every caller, so this costs almost nothing under load, and a
  // staff price edit becomes visible within the window rather than instantly.
  @Header("cache-control", "public, max-age=300, stale-while-revalidate=3600")
  async get() {
    const pricing = await this.pricing.publicPricing();
    if (!pricing) {
      // Nothing published is a legitimate state: no public book is seeded, because inventing a
      // public rate would be the fabricated pricing ADR-0010 §11 forbids.
      throw notFound(
        "public_pricing_not_configured",
        "No public pricing has been published.",
      );
    }
    return pricing;
  }
}

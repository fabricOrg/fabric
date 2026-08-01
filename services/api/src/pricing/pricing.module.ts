import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { CommercialOfferMarginService } from "./commercial-offer-margin.service.js";
import { CommercialOfferPublishService } from "./commercial-offer-publish.service.js";
import { CommercialOffersController } from "./commercial-offers.controller.js";
import { CommercialOffersService } from "./commercial-offers.service.js";
import { EffectivePricingService } from "./effective-pricing.service.js";
import { OfferCatalogService } from "./offer-catalog.service.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";
import { PublicPricingController } from "./public-pricing.controller.js";

/**
 * Pricing (ADR-0010 + ADR-0012) — resolves per-account rate tables for the send path AND serves the
 * admin-console control plane for both pay-as-you-go price books and prepaid commercial offers. Reads
 * and writes control-plane state through the provisioning connection; PricingService is exported so
 * the SMS engine + preview service price against the book. AuditModule records every price change;
 * BffTokenGuard protects the admin endpoints.
 */
@Module({
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [
    PricingController,
    PublicPricingController,
    CommercialOffersController,
  ],
  providers: [
    PricingService,
    EffectivePricingService,
    PriceBookAdminService,
    CommercialOfferMarginService,
    CommercialOffersService,
    CommercialOfferPublishService,
    OfferCatalogService,
    BffTokenGuard,
  ],
  exports: [PricingService, EffectivePricingService],
})
export class PricingModule {}

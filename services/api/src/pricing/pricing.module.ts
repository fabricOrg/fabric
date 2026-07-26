import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { PriceBookAdminService } from "./price-book-admin.service.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";
import { PublicPricingController } from "./public-pricing.controller.js";

/**
 * Pricing (ADR-0010) — resolves per-account rate tables for the send path AND serves the admin-console
 * price-book control plane (slice 3). Reads/writes control-plane price books through the provisioning
 * connection; PricingService is exported so the SMS engine + preview service price against the book.
 * AuditModule records every price-book edit; BffTokenGuard protects the admin endpoints.
 */
@Module({
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [PricingController, PublicPricingController],
  providers: [PricingService, PriceBookAdminService, BffTokenGuard],
  exports: [PricingService],
})
export class PricingModule {}

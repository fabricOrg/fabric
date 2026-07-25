import { Module } from "@nestjs/common";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { PricingService } from "./pricing.service.js";

/**
 * Pricing (ADR-0010 Phase 1) — resolves per-account rate tables for the send path. Reads control-plane
 * price books through the provisioning connection; exported so the SMS engine + preview service price
 * against the account's book. Admin write endpoints (controller) land in slice 3.
 */
@Module({
  imports: [ProvisioningDbModule],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

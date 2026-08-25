import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { StatementService } from "./statement.service.js";
import { WalletController } from "./wallet.controller.js";
import { WalletQueryService } from "./wallet-query.service.js";

// ProvisioningDbModule: the snapshot reports `accounts.billing_currency`, and every other reader of
// that column (`billing-currency.ts`, `effective-pricing`, `token-catalog`) goes through the
// provisioning connection. Reusing their helper rather than adding a fourth way to read one column.
@Module({
  imports: [ApiKeysModule, ProvisioningDbModule],
  controllers: [WalletController],
  providers: [WalletQueryService, StatementService],
})
export class WalletModule {}

import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { WalletController } from "./wallet.controller.js";
import { WalletQueryService } from "./wallet-query.service.js";

@Module({
  imports: [ApiKeysModule],
  controllers: [WalletController],
  providers: [WalletQueryService],
})
export class WalletModule {}

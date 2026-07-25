import type { DeliveryMode } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { RateTable } from "@app/domain";
import type {
  Creds,
  SmsSenderPlugin,
  VirtualPhoneProvider,
} from "@app/integrations";
import type { FakeProvider } from "@app/integrations/testing";
import {
  dispatchSend as engineDispatchSend,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_DB } from "../db/db.module.js";
import { dispatchSend as dispatchProviderSend } from "./sms-dispatch.js";
import { buildSmsProviders } from "./sms-providers.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";
import { maybeAutoStop } from "./virtual-phone-auto-stop.js";

@Injectable()
export class SmsRuntimeService {
  readonly provider: SmsSenderPlugin;
  readonly virtualProvider: VirtualPhoneProvider;
  readonly legacySandboxProvider: FakeProvider;
  readonly liveReady: boolean;
  readonly liveReadinessReason: string | null;
  private readonly creds: Creds | undefined;

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) config: ConfigService,
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
  ) {
    const wired = buildSmsProviders(config, new Logger(SmsRuntimeService.name));
    this.provider = wired.provider;
    this.creds = wired.creds;
    this.virtualProvider = wired.virtualProvider;
    this.legacySandboxProvider = wired.legacySandboxProvider;
    this.liveReady = wired.liveReady;
    this.liveReadinessReason = wired.liveReadinessReason;
  }

  /**
   * Engine deps for a delivery mode. `rates` (the account's resolved SMS price book) is only consumed
   * by prepareSend's rateSegments — dispatch/DLR/sweep never reprice (they recover cost from the
   * reservation), so callers pass it only at prepare time. Omitted → the engine's compiled default.
   */
  deps(deliveryMode: DeliveryMode = "live", rates?: RateTable) {
    const base =
      deliveryMode === "virtual"
        ? { db: this.db, provider: this.virtualProvider }
        : {
            db: this.db,
            provider: this.provider,
            ...(this.creds ? { creds: this.creds } : {}),
          };
    return rates ? { ...base, rates } : base;
  }

  async dispatch(
    input: SendInput,
    prepared: PreparedSend,
    deliveryMode: DeliveryMode,
  ): Promise<SendResult> {
    const result = await dispatchProviderSend({
      deps: this.deps(deliveryMode),
      virtualProvider: this.virtualProvider,
      input,
      prepared,
      deliveryMode,
    });
    if (deliveryMode === "virtual") {
      await maybeAutoStop(this.virtualPhone, input, result);
    }
    return result;
  }

  legacyDispatch(
    input: SendInput,
    prepared: PreparedSend,
  ): Promise<SendResult> {
    return engineDispatchSend(
      { db: this.db, provider: this.legacySandboxProvider },
      input,
      prepared,
    );
  }
}

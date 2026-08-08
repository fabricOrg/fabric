import { randomUUID } from "node:crypto";
import type {
  PurchaseCommercialOfferRequest,
  PurchaseCommercialOfferResponse,
} from "@app/contracts";
import { purchaseCommercialOfferResponseSchema } from "@app/contracts";
import { type AppDb, type ProvisioningDb, tokenPurchases } from "@app/db";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import {
  resolvePaymentContext,
  webhookModeMismatch,
} from "../payments/payment-provider-resolution.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { createCommercialOfferPurchaseIntent } from "./commercial-offer-purchase.js";
import { grantTokensForPurchase } from "./token-grant.js";

/**
 * Offer-backed prepaid checkout. The database snapshot is authoritative: the browser supplies only
 * an offer-version id and pack count, and a verified webhook must match the stored amount/currency
 * before any entitlement or accounting movement is granted.
 */
@Injectable()
export class TokenPurchaseService {
  private readonly logger = new Logger(TokenPurchaseService.name);

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  private resolved(tenantId: string) {
    return resolvePaymentContext(
      {
        provisioning: this.provisioning,
        config: this.config,
        resolver: this.resolver,
      },
      tenantId,
    );
  }

  /** Persist the immutable purchase promise, then return the provider's hosted-checkout URL. */
  async initiate(
    tenantId: string,
    request: PurchaseCommercialOfferRequest,
  ): Promise<PurchaseCommercialOfferResponse> {
    if (await this.killSwitch.isPaused("platform.payments", tenantId)) {
      throw invalidRequest(
        "payments_paused",
        "Token purchases are paused right now.",
      );
    }
    const { provider, creds, mode, instanceId, credentialVersion } =
      await this.resolved(tenantId);
    const reference = `token-${randomUUID()}`;
    const intent = await createCommercialOfferPurchaseIntent(
      this.provisioning.db,
      {
        tenantId,
        reference,
        request,
        providerMode: mode,
        pluginInstanceId: instanceId,
        credentialVersion,
      },
    );

    const base = this.config.get<string>("DASHBOARD_BASE_URL")?.trim();
    const init = await provider.initCharge(
      {
        amountMinor: intent.amountMinor,
        currency: intent.currency,
        email: request.email,
        reference,
        ...(base
          ? {
              callbackUrl: `${base.replace(/\/$/, "")}/wallet?tokens=1&reference=${encodeURIComponent(reference)}`,
            }
          : {}),
        metadata: {
          tenant_id: tenantId,
          tokens: true,
          offer_version_id: intent.offerVersionId,
          pack_count: intent.packCount,
        },
      },
      creds,
    );
    await this.provisioning.db
      .update(tokenPurchases)
      .set({ providerRef: init.providerRef, updatedAt: new Date() })
      .where(eq(tokenPurchases.reference, reference));

    return purchaseCommercialOfferResponseSchema.parse({
      authorization_url: init.authorizationUrl,
      reference,
      offer_version_id: intent.offerVersionId,
      pack_count: intent.packCount,
      items: intent.items.map((item) => ({
        channel_code: item.channelCode,
        unit_code: item.unitCode,
        quantity: item.quantity.toString(),
      })),
      amount_minor: intent.amountMinor.toString(),
      currency: intent.currency,
    });
  }

  /** Reconcile a verified Paystack success event and grant its stored promise exactly once. */
  async completeFromWebhook(
    reference: string,
    event: {
      amountMinor?: bigint;
      currency?: string;
      verifiedMode: "sandbox" | "live";
    },
  ): Promise<void> {
    const [purchase] = await this.provisioning.db
      .select()
      .from(tokenPurchases)
      .where(eq(tokenPurchases.reference, reference))
      .limit(1);
    if (!purchase) {
      this.logger.warn(`Token webhook for unknown reference ${reference}`);
      return;
    }
    if (webhookModeMismatch(purchase.providerMode, event.verifiedMode)) {
      this.logger.error(
        `Token webhook credential mode mismatch for ${purchase.reference}`,
      );
      throw unauthorized(
        "credential_mode_mismatch",
        "Webhook credentials do not match the token purchase that created it.",
      );
    }
    if (purchase.status === "success") return;
    if (
      (event.amountMinor !== undefined &&
        event.amountMinor !== purchase.amountMinor) ||
      (event.currency &&
        event.currency.toUpperCase() !== purchase.currency.toUpperCase())
    ) {
      this.logger.error(
        `Token webhook amount/currency mismatch for ${purchase.reference}`,
      );
      await this.provisioning.db
        .update(tokenPurchases)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(tokenPurchases.reference, purchase.reference));
      return;
    }

    await grantTokensForPurchase(
      { provisioning: this.provisioning, appDb: this.appDb },
      reference,
    );
    await this.provisioning.db
      .update(tokenPurchases)
      .set({ status: "success", updatedAt: new Date() })
      .where(eq(tokenPurchases.reference, purchase.reference));
  }
}

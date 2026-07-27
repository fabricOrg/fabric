import { randomUUID } from "node:crypto";
import type {
  PurchaseTokensRequest,
  PurchaseTokensResponse,
} from "@app/contracts";
import {
  type AppDb,
  type MinorUnits,
  type ProvisioningDb,
  priceBookRates,
  priceBooks,
  type TenantId,
  tokenPurchases,
} from "@app/db";
import { type Creds, PaystackProvider } from "@app/integrations";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { grantTokensForPurchase } from "./token-grant.js";

/**
 * TOKEN PURCHASE (ADR-0010 Phase 2, slice 2c-iii) — buying a fixed quantity of sends up front, with
 * the price locked at purchase. Mirrors the wallet top-up flow: a pending intent, a hosted checkout,
 * and a grant that only lands once the signature-verified webhook confirms the money cleared.
 *
 * THE PRICE IS RESOLVED HERE, SERVER-SIDE, from the default TOKEN price book — never accepted from
 * the caller. There is deliberately no seeded default token book, so token purchase is unavailable
 * until staff configure one in the admin console: shipping an invented token price would be exactly
 * the fabricated rate ADR-0010 §11 forbids.
 */
@Injectable()
export class TokenPurchaseService {
  private readonly logger = new Logger(TokenPurchaseService.name);
  private readonly provider = new PaystackProvider();

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
  ) {}

  private creds(): Creds {
    const secretKey = this.config.get<string>("PAYSTACK_SECRET_KEY");
    if (!secretKey) {
      throw invalidRequest(
        "payments_not_configured",
        "Payments are not configured.",
      );
    }
    return { secretKey };
  }

  /**
   * The locked unit price for (channel, currency) from the default token book. Absent book or rate
   * fails CLOSED — we will not guess a price for money.
   */
  private async resolveTokenPrice(
    channel: string,
    currency: string,
  ): Promise<bigint> {
    const [row] = await this.provisioning.db
      .select({ unitPriceMinor: priceBookRates.unitPriceMinor })
      .from(priceBookRates)
      .innerJoin(priceBooks, eq(priceBooks.id, priceBookRates.priceBookId))
      .where(
        and(
          eq(priceBooks.mode, "token"),
          eq(priceBooks.isDefault, true),
          eq(priceBookRates.channel, channel),
          eq(priceBookRates.currency, currency),
        ),
      )
      .limit(1);
    if (!row) {
      throw invalidRequest(
        "token_price_unavailable",
        "Tokens are not on sale for this channel and currency yet.",
      );
    }
    return row.unitPriceMinor;
  }

  /** Create the purchase intent and hand back a hosted-checkout URL. Grants nothing yet. */
  async initiate(
    tenantId: string,
    request: PurchaseTokensRequest,
  ): Promise<PurchaseTokensResponse> {
    if (await this.killSwitch.isPaused("platform.payments")) {
      throw invalidRequest(
        "payments_paused",
        "Token purchases are paused right now.",
      );
    }
    const creds = this.creds();
    // Only SMS can SPEND tokens today: the hold/settle path lives in the sms engine's prepareSend,
    // while the email accept path still reserves from the wallet directly. Selling an email token
    // would take money for an entitlement that can never be consumed — the lot would sit unusable,
    // the deferred-revenue liability would never discharge, and the customer would pay twice (once
    // for tokens, then per email from the wallet). Refuse until the email send path consumes tokens.
    if (request.channel !== "sms") {
      throw invalidRequest(
        "token_channel_unavailable",
        "Tokens are only available for SMS today. Email sends bill from the wallet.",
        "channel",
      );
    }
    const unitPrice = await this.resolveTokenPrice(
      request.channel,
      request.currency,
    );
    const quantity = BigInt(request.quantity);
    const amountMinor = quantity * unitPrice;
    // The provider serializes the charge amount through `Number()`, so anything past 2^53 is rounded
    // on the way to checkout. The webhook would then disagree with the exact `amount_minor` we
    // stored, we would mark the purchase failed, and the buyer would be charged with nothing granted.
    // Refuse BEFORE writing an intent or taking money — a misconfigured token price should stop the
    // sale, not produce a silent half-completed one.
    if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidRequest(
        "token_amount_too_large",
        "That quantity exceeds the largest charge we can process exactly. Buy a smaller batch.",
        "quantity",
      );
    }
    // Paystack references allow alphanumerics + - . = (no colon); the `token-` prefix is what the
    // webhook branches on to tell a token purchase from a wallet top-up.
    const reference = `token-${randomUUID()}`;

    await this.provisioning.db.insert(tokenPurchases).values({
      tenantId: tenantId as TenantId,
      reference,
      channel: request.channel,
      quantity,
      unitPriceMinorLocked: unitPrice as MinorUnits,
      currency: request.currency,
      amountMinor: amountMinor as MinorUnits,
      email: request.email,
    });

    const base = this.config.get<string>("DASHBOARD_BASE_URL")?.trim();
    const init = await this.provider.initCharge(
      {
        amountMinor,
        currency: request.currency,
        email: request.email,
        reference,
        ...(base
          ? { callbackUrl: `${base.replace(/\/$/, "")}/wallet?tokens=1` }
          : {}),
        metadata: { tenant_id: tenantId, tokens: true },
      },
      creds,
    );
    await this.provisioning.db
      .update(tokenPurchases)
      .set({ providerRef: init.providerRef, updatedAt: new Date() })
      .where(eq(tokenPurchases.reference, reference));

    return {
      authorization_url: init.authorizationUrl,
      reference,
      unit_price_minor: unitPrice.toString(),
      amount_minor: amountMinor.toString(),
    };
  }

  /**
   * Complete a cleared token purchase. Called from the Paystack webhook AFTER the signature check,
   * so the caller has already proven authenticity; here we re-check the amount and currency against
   * the STORED intent, exactly as the top-up path does, before granting anything.
   */
  async completeFromWebhook(
    reference: string,
    event: { amountMinor?: bigint; currency?: string },
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
    if (purchase.status === "success") return; // already granted

    // Never trust the webhook's numbers — reconcile against what we recorded at initiate.
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

    // The grant is idempotent end to end (ledger key + the lot's grant-once index), so a duplicate
    // callback and webhook both firing still grants exactly once.
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

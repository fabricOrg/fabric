import { randomUUID } from "node:crypto";
import type { AutoTopupResponse, UpdateAutoTopupRequest } from "@app/contracts";
import {
  type AppDb,
  autoTopup,
  type MinorUnits,
  type ProvisioningDb,
  paymentAuthorizations,
  payments,
  type TenantId,
} from "@app/db";
import { type Creds, PaystackProvider } from "@app/integrations";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";

/**
 * Auto top-up (E4) — when a tenant's wallet balance falls to/below a configured threshold, charge
 * the saved (reusable) card for the top-up amount. The credit lands via the same Paystack
 * charge.success webhook as a manual top-up (idempotent on the reference), so this service only
 * TRIGGERS the charge — PaymentsService.handleWebhook does the crediting. SANDBOX only (sk_test_);
 * the platform.payments kill-switch gates auto-charges just like manual ones.
 */
@Injectable()
export class AutoTopupService {
  private readonly logger = new Logger(AutoTopupService.name);
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

  async getAutoTopup(tenantId: string): Promise<AutoTopupResponse> {
    const scoped = tenantId as TenantId;
    const [row] = await this.provisioning.db
      .select()
      .from(autoTopup)
      .where(eq(autoTopup.tenantId, scoped))
      .limit(1);
    const [card] = await this.provisioning.db
      .select({ id: paymentAuthorizations.id })
      .from(paymentAuthorizations)
      .where(eq(paymentAuthorizations.tenantId, scoped))
      .limit(1);
    return {
      has_card: Boolean(card),
      config: row
        ? {
            enabled: row.enabled,
            threshold_minor: row.thresholdMinor.toString(),
            top_up_minor: row.topUpMinor.toString(),
            currency: row.currency as "GHS" | "NGN" | "USD",
          }
        : null,
    };
  }

  async updateAutoTopup(
    tenantId: string,
    request: UpdateAutoTopupRequest,
  ): Promise<AutoTopupResponse> {
    const scoped = tenantId as TenantId;
    if (request.enabled) {
      const [card] = await this.provisioning.db
        .select({ id: paymentAuthorizations.id })
        .from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.tenantId, scoped))
        .limit(1);
      if (!card) {
        throw invalidRequest(
          "no_saved_card",
          "Pay once by card to enable auto top-up (no reusable card on file).",
        );
      }
    }
    const values = {
      tenantId: scoped,
      enabled: request.enabled,
      thresholdMinor: BigInt(request.threshold_minor) as MinorUnits,
      topUpMinor: BigInt(request.top_up_minor) as MinorUnits,
      currency: request.currency,
    };
    await this.provisioning.db
      .insert(autoTopup)
      .values(values)
      .onConflictDoUpdate({
        target: autoTopup.tenantId,
        set: {
          enabled: values.enabled,
          thresholdMinor: values.thresholdMinor,
          topUpMinor: values.topUpMinor,
          currency: values.currency,
          updatedAt: new Date(),
        },
      });
    return this.getAutoTopup(tenantId);
  }

  /**
   * After-debit trigger: if auto top-up is on and the balance has fallen to/below the threshold,
   * charge the saved card and let the webhook credit. Fire-and-forget from the send path — every
   * guard fails SAFE (returns without charging), and an in-flight pending payment blocks re-firing so
   * a burst of sends can't trigger a storm of charges. Never throws to the caller.
   */
  async maybeAutoTopUp(tenantId: string): Promise<void> {
    try {
      const scoped = tenantId as TenantId;
      const [cfg] = await this.provisioning.db
        .select()
        .from(autoTopup)
        .where(eq(autoTopup.tenantId, scoped))
        .limit(1);
      if (!cfg || !cfg.enabled) return;
      if (await this.killSwitch.isPaused("platform.payments")) return;

      // In-flight guard: any pending payment (manual or auto) blocks a new auto-charge.
      const [pending] = await this.provisioning.db
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(eq(payments.tenantId, scoped), eq(payments.status, "pending")),
        )
        .limit(1);
      if (pending) return;

      const balance = await this.customerBalance(scoped, cfg.currency);
      if (balance > cfg.thresholdMinor) return;

      const [auth] = await this.provisioning.db
        .select()
        .from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.tenantId, scoped))
        .limit(1);
      if (!auth?.reusable || !auth.email) return;

      const reference = `topup-${randomUUID()}`;
      await this.provisioning.db.insert(payments).values({
        tenantId: scoped,
        reference,
        provider: "paystack",
        amountMinor: cfg.topUpMinor,
        currency: cfg.currency,
        email: auth.email,
        status: "pending",
      });
      const result = await this.provider.chargeAuthorization(
        {
          authorizationCode: auth.authorizationCode,
          email: auth.email,
          amountMinor: cfg.topUpMinor,
          currency: cfg.currency,
          reference,
        },
        this.creds(),
      );
      // The webhook credits (idempotent). A synchronous failure marks the intent so it doesn't block.
      if (result.status === "failed") {
        await this.provisioning.db
          .update(payments)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(payments.reference, reference));
      } else if (result.providerRef) {
        await this.provisioning.db
          .update(payments)
          .set({ providerRef: result.providerRef, updatedAt: new Date() })
          .where(eq(payments.reference, reference));
      }
    } catch (error) {
      this.logger.error(
        `Auto top-up check failed for ${tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private async customerBalance(
    tenantId: TenantId,
    currency: string,
  ): Promise<bigint> {
    return this.appDb.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        SELECT balance_minor FROM ledger_accounts
        WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = ${currency}
      `) as { balance_minor: string }[];
      return BigInt(rows[0]?.balance_minor ?? "0");
    });
  }
}

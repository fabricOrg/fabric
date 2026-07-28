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
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, sql } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { runtimeRoleEnabled } from "../runtime/runtime-role.js";
import { resolvePaymentContext } from "./payment-provider-resolution.js";

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

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    // Optional, matching PaymentsService: absent resolver = env fallback, i.e. today's behaviour.
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  /**
   * Same resolution as a manual top-up — an auto-charge must use the workspace's own mode, or a
   * sandbox account could be charged against live keys without anyone choosing that.
   */
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
          nextCheckAt: new Date(),
          updatedAt: new Date(),
        },
      });
    return this.getAutoTopup(tenantId);
  }

  /**
   * After-debit trigger: if auto top-up is on and the balance has fallen to/below the threshold,
   * charge the saved card and let the webhook credit. A partial unique index on payments elects
   * exactly one pending automatic charge per tenant, including across concurrent API replicas.
   */
  async maybeAutoTopUp(tenantId: string): Promise<void> {
    try {
      const scoped = tenantId as TenantId;
      const [cfg] = await this.provisioning.db
        .select()
        .from(autoTopup)
        .where(eq(autoTopup.tenantId, scoped))
        .limit(1);
      if (!cfg?.enabled) return;
      if (await this.killSwitch.isPaused("platform.payments")) return;

      const balance = await this.customerBalance(scoped, cfg.currency);
      if (balance > cfg.thresholdMinor) return;

      const [auth] = await this.provisioning.db
        .select()
        .from(paymentAuthorizations)
        .where(eq(paymentAuthorizations.tenantId, scoped))
        .limit(1);
      if (!auth?.reusable || !auth.email) return;

      const { provider, creds, mode, instanceId, credentialVersion } =
        await this.resolved(scoped);
      let reference = `autotopup-${randomUUID()}`;
      let amountMinor = cfg.topUpMinor;
      let currency = cfg.currency;
      let email = auth.email;
      const inserted = await this.provisioning.db
        .insert(payments)
        .values({
          tenantId: scoped,
          reference,
          kind: "auto_topup",
          provider: "paystack",
          providerMode: mode,
          pluginInstanceId: instanceId,
          credentialVersion,
          amountMinor: cfg.topUpMinor,
          currency: cfg.currency,
          email: auth.email,
          status: "pending",
        })
        // Both the partial per-tenant guard and global provider reference are replay boundaries.
        .onConflictDoNothing()
        .returning({ id: payments.id });
      if (inserted.length === 0) {
        const [pending] = await this.provisioning.db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, scoped),
              eq(payments.kind, "auto_topup"),
              eq(payments.status, "pending"),
            ),
          )
          .limit(1);
        if (!pending?.updatedAt || pending.providerRef) return;
        if (Date.now() - pending.updatedAt.getTime() < 30_000) return;
        if (
          pending.providerMode !== mode ||
          pending.pluginInstanceId !== instanceId ||
          pending.credentialVersion !== credentialVersion
        ) {
          this.logger.error(
            `Auto top-up ${pending.reference} requires an unavailable credential binding.`,
          );
          return;
        }
        const verified = await provider.verifyCharge(pending.reference, creds);
        if (verified) {
          await this.recordProviderResult(pending.reference, verified);
          return;
        }
        reference = pending.reference;
        amountMinor = pending.amountMinor;
        currency = pending.currency;
        email = pending.email;
      }
      const result = await provider.chargeAuthorization(
        {
          authorizationCode: auth.authorizationCode,
          email,
          amountMinor,
          currency,
          reference,
        },
        creds,
      );
      await this.recordProviderResult(reference, result);
    } catch (error) {
      this.logger.error(
        `Auto top-up check failed for ${tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /**
   * Durable threshold trigger: configuration and wallet balance survive process restarts. Runtime
   * role separation later confines this scan to scheduler tasks; database uniqueness makes it safe
   * while schedules still run in every API replica.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledCheck(): Promise<void> {
    if (
      !runtimeRoleEnabled(this.config, "scheduler") ||
      this.config.get<string>("MAINTENANCE_CRON_ENABLED") === "false"
    ) {
      return;
    }
    const claimed = await this.provisioning.db.transaction(async (tx) => {
      return (await tx.execute(sql`
        WITH due AS (
          SELECT id FROM auto_topup
          WHERE enabled = true AND next_check_at <= now()
          ORDER BY next_check_at, tenant_id
          FOR UPDATE SKIP LOCKED
          LIMIT 100
        )
        UPDATE auto_topup a
        SET next_check_at = now() + interval '1 minute', updated_at = now()
        FROM due
        WHERE a.id = due.id
        RETURNING a.tenant_id
      `)) as Array<{ tenant_id: string }>;
    });
    for (const row of claimed) {
      await this.maybeAutoTopUp(String(row.tenant_id));
    }
  }

  private async recordProviderResult(
    reference: string,
    result: { status: "success" | "failed" | "pending"; providerRef?: string },
  ): Promise<void> {
    // The webhook remains the source of truth for credit. A provider reference marks successful
    // submission; failed is terminal and releases the per-tenant uniqueness guard.
    const update: {
      updatedAt: Date;
      status?: "failed";
      providerRef?: string;
    } = { updatedAt: new Date() };
    if (result.status === "failed") {
      update.status = "failed";
    } else {
      update.providerRef = result.providerRef ?? reference;
    }
    await this.provisioning.db
      .update(payments)
      .set(update)
      .where(eq(payments.reference, reference));
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

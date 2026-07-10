import { randomUUID } from "node:crypto";
import type {
  InitiateTopUpRequest,
  InitiateTopUpResponse,
  PaymentMethodResponse,
} from "@app/contracts";
import {
  type AppDb,
  type MinorUnits,
  type ProvisioningDb,
  paymentAuthorizations,
  payments,
  type TenantId,
} from "@app/db";
import { type Creds, PaystackProvider } from "@app/integrations";
import { credit } from "@app/wallet";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";

/**
 * Wallet top-up over Paystack (E4). initiate() opens a hosted checkout and records a PENDING intent;
 * the provider webhook then credits the ledger. The credit is idempotent on the reference and runs
 * under the intent's tenant RLS context — a replayed webhook never double-credits. SANDBOX only
 * (sk_test_); the platform.payments kill-switch gates new top-ups. Amounts stay exact bigint minor
 * units end to end.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
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

  async initiate(
    tenantId: string,
    request: InitiateTopUpRequest,
  ): Promise<InitiateTopUpResponse> {
    if (await this.killSwitch.isPaused("platform.payments")) {
      throw invalidRequest("payments_paused", "Top-ups are paused right now.");
    }
    const creds = this.creds();
    // Paystack references allow only alphanumerics + - . = (no colon); a uuid with a topup- prefix
    // is all hyphens/alphanumerics. Doubles as our credit() idempotency key.
    const reference = `topup-${randomUUID()}`;
    const amountMinor = BigInt(request.amount_minor);

    await this.provisioning.db.insert(payments).values({
      tenantId: tenantId as TenantId,
      reference,
      provider: "paystack",
      amountMinor: amountMinor as MinorUnits,
      currency: request.currency,
      email: request.email,
      status: "pending",
    });

    const base = this.config.get<string>("DASHBOARD_BASE_URL")?.trim();
    const init = await this.provider.initCharge(
      {
        amountMinor,
        currency: request.currency,
        email: request.email,
        reference,
        ...(base ? { callbackUrl: `${base.replace(/\/$/, "")}/wallet` } : {}),
        metadata: { tenant_id: tenantId },
      },
      creds,
    );

    await this.provisioning.db
      .update(payments)
      .set({ providerRef: init.providerRef, updatedAt: new Date() })
      .where(eq(payments.reference, reference));

    return { authorization_url: init.authorizationUrl, reference };
  }

  /**
   * Start a customer collection for a Lighthouse flow (E4). Same Paystack hosted-checkout mechanism
   * as a top-up, but the `flow-` reference lets the webhook complete the owning flow record after it
   * credits. SANDBOX only (sk_test_); the platform.payments kill-switch gates it.
   */
  async startCollection(
    tenantId: string,
    p: { amountMinor: bigint; currency: string; email: string },
  ): Promise<{ authorizationUrl: string; reference: string }> {
    if (await this.killSwitch.isPaused("platform.payments")) {
      throw invalidRequest("payments_paused", "Collections are paused.");
    }
    const creds = this.creds();
    const reference = `flow-${randomUUID()}`;
    await this.provisioning.db.insert(payments).values({
      tenantId: tenantId as TenantId,
      reference,
      provider: "paystack",
      amountMinor: p.amountMinor as MinorUnits,
      currency: p.currency,
      email: p.email,
      status: "pending",
    });
    const base = this.config.get<string>("DASHBOARD_BASE_URL")?.trim();
    const init = await this.provider.initCharge(
      {
        amountMinor: p.amountMinor,
        currency: p.currency,
        email: p.email,
        reference,
        ...(base ? { callbackUrl: `${base.replace(/\/$/, "")}/flows` } : {}),
        metadata: { tenant_id: tenantId, flow: true },
      },
      creds,
    );
    await this.provisioning.db
      .update(payments)
      .set({ providerRef: init.providerRef, updatedAt: new Date() })
      .where(eq(payments.reference, reference));
    return { authorizationUrl: init.authorizationUrl, reference };
  }

  /** Verify + process a Paystack webhook. Credits the wallet once, on charge.success. */
  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<void> {
    const creds = this.creds();
    const raw = rawBody.toString("utf8");
    if (
      !this.provider.verifyWebhook(
        { headers: { "x-paystack-signature": signature ?? "" }, rawBody: raw },
        creds,
      )
    ) {
      throw unauthorized("invalid_signature", "Invalid Paystack signature.");
    }

    const event = this.provider.parseEvent(raw);
    if (event.status !== "success") return; // only successful charges credit

    const [payment] = await this.provisioning.db
      .select()
      .from(payments)
      .where(eq(payments.reference, event.reference))
      .limit(1);
    if (!payment) {
      this.logger.warn(`Webhook for unknown reference ${event.reference}`);
      return;
    }
    if (payment.status === "success") return; // already credited

    // Never trust the webhook amount/currency — reconcile against the stored intent.
    if (
      (event.amountMinor !== undefined &&
        event.amountMinor !== payment.amountMinor) ||
      (event.currency &&
        event.currency.toUpperCase() !== payment.currency.toUpperCase())
    ) {
      this.logger.error(
        `Webhook amount/currency mismatch for ${payment.reference}`,
      );
      await this.provisioning.db
        .update(payments)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(payments.reference, payment.reference));
      return;
    }

    // Capture a reusable card token (auto top-up + real Payment-method card). Latest reusable card
    // wins; non-reusable auths (e.g. mobile money) are ignored.
    const auth = event.authorization;
    if (auth?.reusable && auth.cardType) {
      await this.provisioning.db
        .insert(paymentAuthorizations)
        .values({
          tenantId: payment.tenantId,
          provider: "paystack",
          authorizationCode: auth.authorizationCode,
          email: payment.email,
          cardType: auth.cardType,
          last4: auth.last4 ?? null,
          expMonth: auth.expMonth ?? null,
          expYear: auth.expYear ?? null,
          bank: auth.bank ?? null,
          reusable: true,
        })
        .onConflictDoUpdate({
          target: paymentAuthorizations.tenantId,
          set: {
            authorizationCode: auth.authorizationCode,
            email: payment.email,
            cardType: auth.cardType,
            last4: auth.last4 ?? null,
            expMonth: auth.expMonth ?? null,
            expYear: auth.expYear ?? null,
            bank: auth.bank ?? null,
            reusable: true,
            updatedAt: new Date(),
          },
        });
    }

    // Credit under the tenant's RLS context; idempotent on the reference (topup-{uuid}).
    // idempotencyKey (topup-{uuid}) dedups a replayed webhook; referenceId is omitted — it's a uuid
    // FK to messages, not applicable to a top-up.
    await this.appDb.withTenant(payment.tenantId, async (tx) => {
      const credited = await credit(tx, {
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        idempotencyKey: payment.reference,
      });
      // Transactional outbox (finding 8): emit only when money actually moved THIS call — a
      // replayed webhook (credited.replayed) must not fan out a duplicate event.
      if (!credited.replayed) {
        await tx`
          INSERT INTO outbox_events (tenant_id, event_type, payload)
          VALUES (
            current_setting('app.tenant_id')::uuid,
            'topup.succeeded',
            ${JSON.stringify({
              reference: payment.reference,
              amount_minor: payment.amountMinor.toString(),
              currency: payment.currency,
            })}::jsonb
          )`;
      }
      // A `flow-` reference belongs to a Lighthouse flow → complete its charge + notify now that the
      // collection cleared. No-op for top-ups (no matching flow_records row). Same tenant tx (RLS ok).
      const entries = [
        {
          account: "payments:collection-clearing",
          label: "Customer collection",
          direction: "debit",
          amount: {
            currency: payment.currency,
            minor: payment.amountMinor.toString(),
          },
        },
        {
          account: "wallet:available",
          label: "Tenant wallet",
          direction: "credit",
          amount: {
            currency: payment.currency,
            minor: payment.amountMinor.toString(),
          },
        },
      ];
      await tx`
        UPDATE flow_records SET
          charge_status = 'done', charge_at = now(),
          charge_entries = ${JSON.stringify(entries)}::jsonb,
          notify_status = 'done', notify_message_id = ${`msg_${randomUUID().slice(0, 10)}`}, notify_at = now(),
          status = 'complete', updated_at = now()
        WHERE charge_reference = ${payment.reference} AND status <> 'complete'`;
    });
    await this.provisioning.db
      .update(payments)
      .set({ status: "success", updatedAt: new Date() })
      .where(eq(payments.reference, payment.reference));
  }

  /** The tenant's saved reusable card (Payment-method card + auto-top-up source), or null. */
  async getSavedMethod(tenantId: string): Promise<PaymentMethodResponse> {
    const [row] = await this.provisioning.db
      .select()
      .from(paymentAuthorizations)
      .where(eq(paymentAuthorizations.tenantId, tenantId as TenantId))
      .limit(1);
    if (!row) return { method: null };
    return {
      method: {
        brand: row.cardType,
        last4: row.last4,
        exp:
          row.expMonth && row.expYear ? `${row.expMonth}/${row.expYear}` : null,
      },
    };
  }
}

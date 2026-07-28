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
import { credit } from "@app/wallet";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, unauthorized } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { TokenPurchaseService } from "../tokens/token-purchase.service.js";
import {
  resolvePaymentContext,
  webhookVerificationCandidates,
} from "./payment-provider-resolution.js";
import {
  captureReusableCard,
  completeFlowRecord,
} from "./payment-webhook-effects.js";

/** Paystack top-ups: pending intent, idempotent webhook credit, tenant RLS, and exact minor units. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(APP_DB) private readonly appDb: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Inject(TokenPurchaseService)
    private readonly tokens: TokenPurchaseService,
    // Optional so existing unit/integration fixtures that construct this service directly keep
    // working on the env fallback while the control plane is populated.
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  /**
   * ADR-0011: which processor and credentials this workspace charges with comes from the CONTROL
   * PLANE, keyed by the account's mode — a sandbox workspace resolves test keys, a live one resolves
   * live keys. They are separate instances, so a live charge can never run on test credentials.
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

  async initiate(
    tenantId: string,
    request: InitiateTopUpRequest,
  ): Promise<InitiateTopUpResponse> {
    if (await this.killSwitch.isPaused("platform.payments")) {
      throw invalidRequest("payments_paused", "Top-ups are paused right now.");
    }
    const { provider, creds } = await this.resolved(tenantId);
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
    const init = await provider.initCharge(
      {
        amountMinor,
        currency: request.currency,
        email: request.email,
        reference,
        ...(base
          ? {
              callbackUrl: `${base.replace(/\/$/, "")}/wallet?payment_return=1`,
            }
          : {}),
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
    const { provider, creds } = await this.resolved(tenantId);
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
    const init = await provider.initCharge(
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
    const raw = rawBody.toString("utf8");
    // A webhook carries no tenant, and its signature must be verified BEFORE the body is trusted —
    // so we cannot read the reference to decide whether this is a test or live charge without first
    // trusting unverified input. Instead try each configured key until one HMAC matches. Constant
    // work over keys we own, and forging still requires a valid HMAC under one of them.
    const candidates = await webhookVerificationCandidates({
      provisioning: this.provisioning,
      config: this.config,
      resolver: this.resolver,
    });
    const verified = candidates.find((candidate) =>
      candidate.provider.verifyWebhook(
        { headers: { "x-paystack-signature": signature ?? "" }, rawBody: raw },
        candidate.creds,
      ),
    );
    if (!verified) {
      throw unauthorized("invalid_signature", "Invalid Paystack signature.");
    }

    const event = verified.provider.parseEvent(raw);
    if (event.status !== "success") return; // only successful charges credit

    // ADR-0010 Phase 2: a `token-` reference bought ENTITLEMENT, not wallet money. It grants a
    // price-locked lot against the deferred-revenue liability instead of crediting the balance, so it
    // must never fall through to the top-up path below (which would credit cash the buyer never
    // bought). The signature is already verified above; the amount is reconciled against the stored
    // intent inside the token service, as it is here.
    if (event.reference.startsWith("token-")) {
      await this.tokens.completeFromWebhook(event.reference, {
        ...(event.amountMinor !== undefined
          ? { amountMinor: event.amountMinor }
          : {}),
        ...(event.currency ? { currency: event.currency } : {}),
      });
      return;
    }

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

    await captureReusableCard(this.provisioning, payment, event.authorization);

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
      await completeFlowRecord(tx, payment);
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

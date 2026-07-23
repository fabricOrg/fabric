import type {
  MessageDelivery,
  MessageDeliverySummary,
  MessageDeliveryWebhookStatus,
  SendManagedMessageRequest,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import {
  ManagedCostLimitError,
  ManagedIdempotencyConflictError,
  type ManagedSendContext,
} from "@app/sms-engine";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { EmailService } from "../email/email.service.js";
import {
  apiError,
  asInsufficientFunds,
  invalidRequest,
} from "../http/api-error.js";
import { SmsService } from "../sms/sms.service.js";
import {
  listDeliveries,
  listDeliveryWebhookStatus,
  retrieveDelivery,
} from "./managed-messages-reads.js";
import {
  acceptedPreview,
  assertRecipientMatchesChannel,
  deterministicDeliveryId,
  requestFingerprint,
} from "./managed-send-plan.js";
import { MessagePreviewService } from "./message-preview.service.js";

const CONTENT_RETENTION_DAYS = 30;
// Placeholder sandbox sender. Real from-domain binding + DNS verification (SPF/DKIM/DMARC) is
// deferred to SDK-007 slice 4b/4c; sandbox never delivers to a real MTA (FakeEmailProvider).
const SANDBOX_EMAIL_FROM = "no-reply@sandbox.fabric.dev";

@Injectable()
export class ManagedMessagesService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(MessagePreviewService)
    private readonly previews: MessagePreviewService,
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  async send(input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
    idempotencyKey: string;
    request: SendManagedMessageRequest;
  }): Promise<MessageDelivery> {
    const preview = await this.previews.preview(
      input.tenantId,
      {
        key: input.request.key,
        data: input.request.data,
        currency: input.request.currency,
        to: input.request.to,
        ...(input.request.locale ? { locale: input.request.locale } : {}),
        ...(input.request.channel ? { channel: input.request.channel } : {}),
      },
      input.environmentId,
    );
    assertRecipientMatchesChannel(preview.channel, input.request.to);
    const blocker = preview.blockers[0];
    const rendered = acceptedPreview(preview, blocker);
    const maxCost = input.request.limits?.max_cost;
    if (maxCost && maxCost.currency !== input.request.currency) {
      throw invalidRequest(
        "max_cost_currency_mismatch",
        "limits.max_cost.currency must match currency.",
        "limits.max_cost.currency",
      );
    }
    if (maxCost && BigInt(rendered.costMinor) > BigInt(maxCost.minor)) {
      throw invalidRequest(
        "max_cost_exceeded",
        "The planned message exceeds limits.max_cost.",
        "limits.max_cost",
      );
    }
    const fingerprint = requestFingerprint(input.request);
    const deliveryId = deterministicDeliveryId({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      environmentId: input.environmentId,
      idempotencyKey: input.idempotencyKey,
    });
    const managed: ManagedSendContext = {
      deliveryId,
      definitionId: preview.definition_id,
      versionId: preview.version_id,
      key: input.request.key,
      locale: preview.resolved_locale,
      ...(input.request.reference
        ? { reference: input.request.reference }
        : {}),
      metadata: input.request.metadata,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      ...(maxCost ? { maxCostMinor: maxCost.minor } : {}),
      expiresAt: new Date(Date.now() + CONTENT_RETENTION_DAYS * 86_400_000),
    };
    try {
      if (rendered.channel === "email") {
        await this.email.acceptManaged({
          tenantId: input.tenantId,
          deliveryId,
          applicationId: input.applicationId,
          environmentId: input.environmentId,
          to: input.request.to,
          from: preview.email_from ?? SANDBOX_EMAIL_FROM,
          subject: rendered.subject,
          text: rendered.text ?? null,
          html: rendered.html ?? null,
          currency: input.request.currency,
          costMinor: rendered.costMinor,
          managed,
        });
      } else {
        await this.sms.send({
          tenantId: input.tenantId,
          messageId: deliveryId,
          applicationId: input.applicationId,
          environmentId: input.environmentId,
          to: input.request.to,
          senderId: preview.sender.sender_id,
          body: rendered.body,
          currency: input.request.currency,
          messageClass: preview.message_class,
          managed,
        });
      }
    } catch (error) {
      if (error instanceof ManagedIdempotencyConflictError) {
        throw apiError({
          type: "idempotency_error",
          code: "idempotency_conflict",
          message:
            "This Idempotency-Key was already used with a different managed message request.",
          status: 409,
        });
      }
      if (error instanceof ManagedCostLimitError) {
        throw invalidRequest(
          "max_cost_exceeded",
          "The planned message exceeds limits.max_cost.",
          "limits.max_cost",
        );
      }
      // The reserve rides the acceptance transaction, so a balance rejection means nothing was
      // written. Surface it as the declared 402 category instead of letting it escape as a 500 —
      // callers must be able to branch on "top up" without string-matching a server fault.
      // (asInsufficientFunds rethrows anything that isn't the wallet error, preserving `throw error`.)
      asInsufficientFunds(
        error,
        "The sandbox wallet balance can't cover this message.",
      );
    }
    return this.retrieve({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      environmentId: input.environmentId,
      deliveryId,
    });
  }

  async retrieve(input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
    deliveryId: string;
  }): Promise<MessageDelivery> {
    return retrieveDelivery(
      this.db,
      {
        sms: this.sms,
        email: {
          get: (tenantId, id, environmentId) =>
            this.email.get(tenantId, environmentId ?? "", id),
        },
      },
      input,
    );
  }

  async list(input: {
    tenantId: string;
    environmentId: string;
  }): Promise<MessageDeliverySummary[]> {
    return listDeliveries(this.db, input);
  }

  async webhooks(input: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
    deliveryId: string;
  }): Promise<MessageDeliveryWebhookStatus[]> {
    return listDeliveryWebhookStatus(this.db, input);
  }
}

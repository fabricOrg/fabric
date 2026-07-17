import { createHash } from "node:crypto";
import {
  type MessageDelivery,
  messageDelivery as messageDeliverySchema,
  type SendManagedMessageRequest,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  type EnvironmentId,
  environments,
  messageDeliveries,
  messageDeliveryAttempts,
  type TenantId,
} from "@app/db";
import {
  ManagedCostLimitError,
  ManagedIdempotencyConflictError,
} from "@app/sms-engine";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { apiError, invalidRequest, notFound } from "../http/api-error.js";
import { SmsService } from "../sms/sms.service.js";
import { MessagePreviewService } from "./message-preview.service.js";

const CONTENT_RETENTION_DAYS = 30;

@Injectable()
export class ManagedMessagesService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(MessagePreviewService)
    private readonly previews: MessagePreviewService,
    @Inject(SmsService) private readonly sms: SmsService,
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
      },
      input.environmentId,
    );
    const blocker = preview.blockers[0];
    if (blocker || !preview.preview || !preview.eligible) {
      throw invalidRequest(
        blocker?.code ?? "message_not_eligible",
        "The managed message is not eligible to send.",
        blocker?.path || undefined,
      );
    }
    const maxCost = input.request.limits?.max_cost;
    if (maxCost && maxCost.currency !== input.request.currency) {
      throw invalidRequest(
        "max_cost_currency_mismatch",
        "limits.max_cost.currency must match currency.",
        "limits.max_cost.currency",
      );
    }
    if (maxCost && BigInt(preview.preview.cost_minor) > BigInt(maxCost.minor)) {
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
    try {
      await this.sms.send({
        tenantId: input.tenantId,
        messageId: deliveryId,
        applicationId: input.applicationId,
        environmentId: input.environmentId,
        to: input.request.to,
        senderId: preview.sender.sender_id,
        body: preview.preview.body,
        currency: input.request.currency,
        messageClass: preview.message_class,
        managed: {
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
        },
      });
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
      throw error;
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
    const state = await this.db.withTenantDrizzle(
      input.tenantId,
      async (tx) => {
        const [delivery] = await tx
          .select({
            id: messageDeliveries.id,
            key: messageDeliveries.key,
            versionId: messageDeliveries.versionId,
            locale: messageDeliveries.locale,
            channel: messageDeliveries.channel,
            status: messageDeliveries.status,
            resourceVersion: messageDeliveries.resourceVersion,
            reference: messageDeliveries.reference,
            metadata: messageDeliveries.metadata,
            currency: messageDeliveries.currency,
            totalCostMinor: messageDeliveries.totalCostMinor,
            createdAt: messageDeliveries.createdAt,
            updatedAt: messageDeliveries.updatedAt,
            environment: environments.type,
          })
          .from(messageDeliveries)
          .innerJoin(
            environments,
            eq(environments.id, messageDeliveries.environmentId),
          )
          .where(
            and(
              eq(messageDeliveries.tenantId, input.tenantId as TenantId),
              eq(
                messageDeliveries.applicationId,
                input.applicationId as ApplicationId,
              ),
              eq(
                messageDeliveries.environmentId,
                input.environmentId as EnvironmentId,
              ),
              eq(messageDeliveries.id, input.deliveryId),
            ),
          )
          .limit(1);
        if (!delivery) {
          throw notFound(
            "message_delivery_not_found",
            "No managed delivery with that id.",
          );
        }
        const attempts = await tx
          .select()
          .from(messageDeliveryAttempts)
          .where(eq(messageDeliveryAttempts.deliveryId, input.deliveryId))
          .orderBy(asc(messageDeliveryAttempts.ordinal));
        return { delivery, attempts };
      },
    );
    const messageId = state.attempts[0]?.messageId;
    const message = messageId
      ? await this.sms.get(input.tenantId, messageId, input.environmentId)
      : null;
    return messageDeliverySchema.parse({
      id: state.delivery.id,
      key: state.delivery.key,
      version_id: state.delivery.versionId,
      environment: state.delivery.environment,
      locale: state.delivery.locale,
      channel: state.delivery.channel,
      status: state.delivery.status,
      resource_version: state.delivery.resourceVersion,
      recipient: message?.to ?? "redacted",
      reference: state.delivery.reference,
      metadata: state.delivery.metadata,
      cost: {
        minor: state.delivery.totalCostMinor.toString(),
        currency: state.delivery.currency,
      },
      attempts: state.attempts.map((attempt) => ({
        id: attempt.id,
        ordinal: attempt.ordinal,
        channel: attempt.channel,
        message_id: attempt.messageId,
        status: attempt.status,
        cost: {
          minor: attempt.costMinor.toString(),
          currency: attempt.currency,
        },
        error_code: attempt.errorCode,
        created_at: attempt.createdAt.toISOString(),
        updated_at: attempt.updatedAt.toISOString(),
      })),
      created_at: state.delivery.createdAt.toISOString(),
      updated_at: state.delivery.updatedAt.toISOString(),
    });
  }
}

function requestFingerprint(request: SendManagedMessageRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

function deterministicDeliveryId(input: {
  tenantId: string;
  applicationId: string;
  environmentId: string;
  idempotencyKey: string;
}): string {
  const bytes = createHash("sha256")
    .update(
      `${input.tenantId}:${input.applicationId}:${input.environmentId}:${input.idempotencyKey}`,
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

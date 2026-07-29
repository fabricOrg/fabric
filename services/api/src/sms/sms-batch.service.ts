import {
  parseApiError,
  type SendSmsBatchRequest,
  type SmsBatchResponse,
  sendSmsRequest,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { apiError, newRequestId, notFound } from "../http/api-error.js";
import { SmsService } from "./sms.service.js";

type Row = Record<string, unknown>;

@Injectable()
export class SmsBatchService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(SmsService) private readonly sms: SmsService,
  ) {}

  async create(
    context: {
      tenantId: string;
      applicationId: string;
      environmentId: string;
    },
    idempotencyKey: string,
    requestHash: string,
    request: SendSmsBatchRequest,
  ): Promise<SmsBatchResponse> {
    const batch = await this.ensureBatch(
      context,
      idempotencyKey,
      requestHash,
      request,
    );
    const pending = (await this.db.withTenant(
      context.tenantId,
      (tx) => tx`
        SELECT id, client_reference FROM message_batch_items
        WHERE batch_id = ${batch.id} AND status = 'pending'
        ORDER BY created_at, id`,
    )) as Row[];
    const byReference = new Map(
      request.items.map((item) => [item.client_reference, item]),
    );
    // Provider delivery is already delegated to the durable sms-send queue when Redis is enabled.
    // Prepare/reserve items concurrently, but cap fan-out so one 100-item request cannot exhaust DB
    // connections or provider sockets in the local inline fallback.
    for (let offset = 0; offset < pending.length; offset += 10) {
      const slice = pending.slice(offset, offset + 10);
      await Promise.all(
        slice.map((row) =>
          this.processItem(context, batch.id, row, byReference),
        ),
      );
    }
    await this.finish(context.tenantId, batch.id);
    return this.get(context.tenantId, context.environmentId, batch.id);
  }

  private async processItem(
    context: {
      tenantId: string;
      applicationId: string;
      environmentId: string;
    },
    batchId: string,
    row: Row,
    byReference: Map<string, SendSmsBatchRequest["items"][number]>,
  ): Promise<void> {
    const clientReference = String(row.client_reference);
    const item = byReference.get(clientReference);
    if (!item) {
      await this.failItem(
        context.tenantId,
        String(row.id),
        "batch_item_missing",
      );
      return;
    }
    const parsed = sendSmsRequest.safeParse({
      to: item.to,
      sender_id: item.sender_id,
      body: item.body,
      currency: item.currency,
      class: item.class,
    });
    if (!parsed.success) {
      await this.failItem(context.tenantId, String(row.id), "invalid_sms");
      return;
    }
    try {
      const result = await this.sms.send({
        tenantId: context.tenantId,
        applicationId: context.applicationId,
        environmentId: context.environmentId,
        messageId: String(row.id),
        to: parsed.data.to,
        senderId: parsed.data.sender_id,
        body: parsed.data.body,
        currency: parsed.data.currency,
        messageClass: parsed.data.class,
      });
      await this.db.withTenant(
        context.tenantId,
        (tx) => tx`
            UPDATE message_batch_items
            SET message_id = ${result.id}, status = ${result.status},
                error_code = NULL, updated_at = now()
            WHERE id = ${String(row.id)} AND batch_id = ${batchId}`,
      );
    } catch (error) {
      const code =
        error instanceof HttpException
          ? parseApiError(error.getResponse()).code
          : "batch_item_failed";
      await this.failItem(context.tenantId, String(row.id), code);
    }
  }

  async get(
    tenantId: string,
    environmentId: string,
    batchId: string,
  ): Promise<SmsBatchResponse> {
    const batches = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT id, status, total_count, accepted_count, failed_count
        FROM message_batches
        WHERE id = ${batchId} AND environment_id = ${environmentId}
        LIMIT 1`,
    )) as Row[];
    const batch = batches[0];
    if (!batch) throw notFound("batch_not_found", "Message batch not found.");
    const items = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT client_reference, message_id, status, error_code
        FROM message_batch_items WHERE batch_id = ${batchId}
        ORDER BY created_at, id`,
    )) as Row[];
    return {
      id: String(batch.id),
      status: batch.status === "completed" ? "completed" : "processing",
      total_count: Number(batch.total_count),
      accepted_count: Number(batch.accepted_count),
      failed_count: Number(batch.failed_count),
      items: items.map((item) => ({
        client_reference: String(item.client_reference),
        message_id: item.message_id ? String(item.message_id) : null,
        status: String(
          item.status,
        ) as SmsBatchResponse["items"][number]["status"],
        error_code: item.error_code ? String(item.error_code) : null,
      })),
      request_id: newRequestId(),
    };
  }

  private async ensureBatch(
    context: { tenantId: string; applicationId: string; environmentId: string },
    idempotencyKey: string,
    requestHash: string,
    request: SendSmsBatchRequest,
  ): Promise<{ id: string }> {
    return this.db.withTenant(context.tenantId, async (tx) => {
      const inserted = (await tx`
        INSERT INTO message_batches (
          tenant_id, application_id, environment_id, idempotency_key,
          request_hash, total_count
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${context.applicationId},
          ${context.environmentId}, ${idempotencyKey}, ${requestHash},
          ${request.items.length}
        ) ON CONFLICT (tenant_id, environment_id, idempotency_key) DO NOTHING
        RETURNING id, request_hash`) as Row[];
      const rows = inserted[0]
        ? inserted
        : ((await tx`
            SELECT id, request_hash FROM message_batches
            WHERE environment_id = ${context.environmentId}
              AND idempotency_key = ${idempotencyKey} LIMIT 1`) as Row[]);
      const batch = rows[0];
      if (!batch) throw new Error("Could not persist message batch.");
      if (batch.request_hash !== requestHash) {
        throw apiError({
          type: "idempotency_error",
          code: "idempotency_key_reused",
          message: "The idempotency key was already used for another batch.",
          status: 409,
        });
      }
      for (const item of request.items) {
        await tx`
          INSERT INTO message_batch_items (
            tenant_id, batch_id, client_reference
          ) VALUES (
            current_setting('app.tenant_id')::uuid, ${String(batch.id)},
            ${item.client_reference}
          ) ON CONFLICT (batch_id, client_reference) DO NOTHING`;
      }
      return { id: String(batch.id) };
    });
  }

  private async failItem(
    tenantId: string,
    itemId: string,
    errorCode: string,
  ): Promise<void> {
    await this.db.withTenant(
      tenantId,
      (tx) => tx`
        UPDATE message_batch_items
        SET status = 'failed', error_code = ${errorCode}, updated_at = now()
        WHERE id = ${itemId}`,
    );
  }

  private async finish(tenantId: string, batchId: string): Promise<void> {
    await this.db.withTenant(
      tenantId,
      (tx) => tx`
        UPDATE message_batches b SET
          status = 'completed',
          accepted_count = counts.accepted,
          failed_count = counts.failed,
          updated_at = now()
        FROM (
          SELECT count(*) FILTER (WHERE message_id IS NOT NULL)::int AS accepted,
                 count(*) FILTER (
                   WHERE message_id IS NULL AND status = 'failed'
                 )::int AS failed
          FROM message_batch_items WHERE batch_id = ${batchId}
        ) counts WHERE b.id = ${batchId}`,
    );
  }
}

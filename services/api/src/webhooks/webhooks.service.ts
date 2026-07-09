import { randomBytes } from "node:crypto";
import type {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  WebhookEndpointDto,
} from "@app/contracts";
import {
  type AppDb,
  type TenantId,
  type WebhookEndpoint,
  webhookEndpoints,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";

/**
 * Tenant webhook endpoint CRUD (finding 8) — /v1/webhooks. Tenant-scoped via withTenantDrizzle
 * (RLS guards the raw signing secret; only this tenant's context can read it). The secret is
 * generated here, returned ONCE, and afterwards only its prefix ever leaves the API.
 */
@Injectable()
export class WebhooksService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async create(
    tenantId: string,
    request: CreateWebhookEndpointRequest,
  ): Promise<CreateWebhookEndpointResponse> {
    // whsec_ + 32 random bytes — verifiable HMAC key, recognizable prefix (Stripe convention).
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const row = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      const [created] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId: tenantId as TenantId,
          url: request.url,
          secret,
          description: request.description ?? null,
        })
        .returning();
      if (!created) throw new Error("webhook endpoint insert returned no row");
      return created;
    });
    return { ...toDto(row), secret };
  }

  async list(tenantId: string): Promise<WebhookEndpointDto[]> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select()
        .from(webhookEndpoints)
        .orderBy(asc(webhookEndpoints.createdAt)),
    );
    return rows.map(toDto);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const deleted = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .delete(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenantId as TenantId),
            eq(webhookEndpoints.id, id),
          ),
        )
        .returning({ id: webhookEndpoints.id }),
    );
    if (deleted.length === 0) {
      throw notFound("webhook_not_found", "No webhook endpoint with that id.");
    }
  }
}

function toDto(row: WebhookEndpoint): WebhookEndpointDto {
  return {
    id: row.id,
    url: row.url,
    status: row.status === "disabled" ? "disabled" : "active",
    description: row.description,
    secret_prefix: `${row.secret.slice(0, 10)}…`,
    created_at: row.createdAt.toISOString(),
  };
}

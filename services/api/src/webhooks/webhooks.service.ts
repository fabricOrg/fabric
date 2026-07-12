import { randomBytes } from "node:crypto";
import type {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  WebhookEndpointDto,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  applications,
  environments,
  type TenantId,
  type WebhookEndpoint,
  webhookEndpoints,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";

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
    opts: { applicationId?: string; envType?: "sandbox" | "live" } = {},
  ): Promise<CreateWebhookEndpointResponse> {
    // whsec_ + 32 random bytes — verifiable HMAC key, recognizable prefix (Stripe convention).
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const envType = opts.envType ?? "sandbox";
    const row = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      // ADR-0004: an endpoint belongs to one application-environment. Mint into the NAMED application
      // (the dashboard's app-detail page) or the workspace's `default` app; the env is the chosen
      // type. Env-filtered DELIVERY (only an env's events reach its endpoints) lands with #8, once
      // outbox events carry an env — endpoints are already partitioned by env here.
      const [env] = await tx
        .select({
          appId: environments.applicationId,
          envId: environments.id,
        })
        .from(environments)
        .innerJoin(
          applications,
          eq(applications.id, environments.applicationId),
        )
        .where(
          and(
            eq(applications.tenantId, tenantId as TenantId),
            opts.applicationId
              ? eq(applications.id, opts.applicationId as ApplicationId)
              : eq(applications.slug, "default"),
            eq(environments.type, envType),
          ),
        )
        .limit(1);
      if (!env) {
        // A named application with no such env → the caller referenced an app not in this workspace
        // (RLS scopes the join); without one, the default app is missing — a provisioning bug.
        if (opts.applicationId) {
          throw invalidRequest(
            "application_not_found",
            "No such application in this workspace.",
            "application_id",
          );
        }
        throw new Error(
          `workspace ${tenantId} has no default ${envType} environment`,
        );
      }
      const [created] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId: tenantId as TenantId,
          applicationId: env.appId,
          environmentId: env.envId,
          url: request.url,
          secret,
          description: request.description ?? null,
        })
        .returning();
      if (!created) throw new Error("webhook endpoint insert returned no row");
      return created;
    });
    return { ...toDto(row, envType), secret };
  }

  async list(
    tenantId: string,
    applicationId?: string,
  ): Promise<WebhookEndpointDto[]> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({
          endpoint: webhookEndpoints,
          envType: environments.type,
        })
        .from(webhookEndpoints)
        .innerJoin(
          environments,
          eq(environments.id, webhookEndpoints.environmentId),
        )
        .where(
          applicationId
            ? and(
                eq(webhookEndpoints.tenantId, tenantId as TenantId),
                eq(
                  webhookEndpoints.applicationId,
                  applicationId as ApplicationId,
                ),
              )
            : eq(webhookEndpoints.tenantId, tenantId as TenantId),
        )
        .orderBy(asc(webhookEndpoints.createdAt)),
    );
    return rows.map((r) => toDto(r.endpoint, r.envType));
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

function toDto(
  row: WebhookEndpoint,
  env: "sandbox" | "live",
): WebhookEndpointDto {
  return {
    id: row.id,
    url: row.url,
    status: row.status === "disabled" ? "disabled" : "active",
    description: row.description,
    env,
    secret_prefix: `${row.secret.slice(0, 10)}…`,
    created_at: row.createdAt.toISOString(),
  };
}

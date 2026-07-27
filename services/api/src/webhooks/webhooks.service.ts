import { randomBytes } from "node:crypto";
import type {
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  WebhookDeliveryDto,
  WebhookEndpointDto,
} from "@app/contracts";
import {
  type AppDb,
  type ApplicationId,
  applications,
  environments,
  outboxEvents,
  type TenantId,
  webhookDeliveries,
  webhookEndpoints,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, asc, eq, sql } from "drizzle-orm";
import { primaryApplicationId } from "../applications/primary-application.js";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import type { PageInput } from "../http/cursor.js";
import { listEndpointDeliveries } from "./webhook-delivery-reads.js";
import { emptyHealth, toDeliveryDto, toEndpointDto } from "./webhook-dto.js";
import { webhookEnvScope } from "./webhook-env-scope.js";
import { resolveWebhookTarget } from "./webhook-url-policy.js";

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    request: CreateWebhookEndpointRequest,
    opts: {
      applicationId?: string;
      environmentId?: string;
      envType?: "sandbox" | "live";
    } = {},
  ): Promise<CreateWebhookEndpointResponse> {
    await resolveWebhookTarget(request.url, this.allowPrivateNetworks());
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const requestedEnvType = opts.envType ?? "sandbox";
    const resolved = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      // BFF-token path names neither an environment nor an application: scope to the workspace's
      // primary application. Resolved here rather than pinned to the slug `default` in the
      // predicate, since a workspace need not have an application by that name.
      const scopeApplicationId =
        opts.applicationId ??
        (opts.environmentId
          ? undefined
          : ((await primaryApplicationId(tx, tenantId)) ?? undefined));
      const envScopeFilter = webhookEnvScope({
        ...(scopeApplicationId ? { applicationId: scopeApplicationId } : {}),
        ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
        envType: requestedEnvType,
      });
      const [env] = await tx
        .select({
          appId: environments.applicationId,
          envId: environments.id,
          envType: environments.type,
        })
        .from(environments)
        .innerJoin(
          applications,
          eq(applications.id, environments.applicationId),
        )
        .where(
          and(eq(applications.tenantId, tenantId as TenantId), envScopeFilter),
        )
        .limit(1);
      if (!env) {
        if (opts.environmentId) {
          throw notFound(
            "environment_not_found",
            "This key's environment no longer exists.",
          );
        }
        if (opts.applicationId) {
          throw invalidRequest(
            "application_not_found",
            "No such application in this workspace.",
            "application_id",
          );
        }
        // Structured, never a bare throw (which surfaced as a 500). This used to be reached by any
        // workspace whose application wasn't slugged "default", and asked the caller to name one as
        // a workaround; resolution now handles that, so getting here means the workspace genuinely
        // has no application with this environment yet.
        throw invalidRequest(
          "application_required",
          `This workspace has no application with a ${requestedEnvType} environment. Create one first.`,
          "application_id",
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
      return { created, envType: env.envType };
    });
    return {
      ...toEndpointDto(resolved.created, resolved.envType, emptyHealth()),
      secret,
    };
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
          pending: sql<number>`(
            SELECT count(*)::int FROM webhook_deliveries d
            WHERE d.endpoint_id = ${webhookEndpoints.id}
              AND d.state IN ('pending', 'delivering')
          )`,
          dead: sql<number>`(
            SELECT count(*)::int FROM webhook_deliveries d
            WHERE d.endpoint_id = ${webhookEndpoints.id} AND d.state = 'dead'
          )`,
          lastDeliveredAt: sql<Date | null>`(
            SELECT max(d.delivered_at) FROM webhook_deliveries d
            WHERE d.endpoint_id = ${webhookEndpoints.id}
          )`,
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
    return rows.map((row) =>
      toEndpointDto(row.endpoint, row.envType, {
        pending: Number(row.pending),
        dead: Number(row.dead),
        last_delivered_at: row.lastDeliveredAt
          ? new Date(String(row.lastDeliveredAt)).toISOString()
          : null,
      }),
    );
  }

  async listDeliveries(
    tenantId: string,
    endpointId: string,
    state: "pending" | "delivering" | "delivered" | "dead" | undefined,
    page: PageInput,
  ): Promise<{ deliveries: WebhookDeliveryDto[]; next_cursor: string | null }> {
    return listEndpointDeliveries(this.db, tenantId, endpointId, state, page);
  }

  async disable(tenantId: string, id: string): Promise<void> {
    const disabled = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      const rows = await tx
        .update(webhookEndpoints)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenantId as TenantId),
            eq(webhookEndpoints.id, id),
          ),
        )
        .returning({ id: webhookEndpoints.id });
      if (rows.length === 0) return rows;
      await tx.execute(sql`
        UPDATE webhook_deliveries
        SET state = 'dead', lease_token = NULL, lease_expires_at = NULL,
            last_error_category = 'endpoint_disabled', updated_at = now()
        WHERE endpoint_id = ${id}::uuid AND state IN ('pending', 'delivering')
      `);
      await tx.execute(sql`
        UPDATE outbox_events o SET delivered_at = now(), updated_at = now()
        WHERE o.delivered_at IS NULL
          AND EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = o.id)
          AND NOT EXISTS (
            SELECT 1 FROM webhook_deliveries d
            WHERE d.event_id = o.id AND d.state IN ('pending', 'delivering')
          )
      `);
      return rows;
    });
    if (disabled.length === 0) {
      throw notFound("webhook_not_found", "No webhook endpoint with that id.");
    }
  }

  async replay(
    tenantId: string,
    endpointId: string,
    deliveryId: string,
    actorKeyId: string,
  ): Promise<WebhookDeliveryDto> {
    const replayed = await this.db.withTenantDrizzle(tenantId, async (tx) => {
      const [row] = await tx
        .update(webhookDeliveries)
        .set({
          state: "pending",
          cycleAttempts: 0,
          nextAttemptAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.tenantId, tenantId as TenantId),
            eq(webhookDeliveries.endpointId, endpointId),
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.state, "dead"),
            sql`EXISTS (
              SELECT 1 FROM webhook_endpoints e
              WHERE e.id = ${endpointId}::uuid AND e.status = 'active'
            )`,
          ),
        )
        .returning();
      if (!row) return null;
      const [event] = await tx
        .select({ eventType: outboxEvents.eventType })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, row.eventId))
        .limit(1);
      if (!event) throw new Error("webhook delivery has no outbox event");
      await tx
        .update(outboxEvents)
        .set({ deliveredAt: null, updatedAt: new Date() })
        .where(eq(outboxEvents.id, row.eventId));
      return toDeliveryDto(row, event.eventType);
    });
    if (!replayed) {
      throw notFound(
        "webhook_delivery_not_replayable",
        "No dead webhook delivery with that id exists for this endpoint.",
      );
    }
    await this.audit.record({
      action: "webhook_delivery.replay",
      targetType: "webhook_delivery",
      targetId: deliveryId,
      summary: "Customer replayed a dead webhook delivery.",
      metadata: {
        tenant_id: tenantId,
        endpoint_id: endpointId,
        actor_key_id: actorKeyId,
      },
    });
    return replayed;
  }

  private allowPrivateNetworks(): boolean {
    return this.config.get<string>("WEBHOOK_ALLOW_PRIVATE_NETWORKS") === "true";
  }
}

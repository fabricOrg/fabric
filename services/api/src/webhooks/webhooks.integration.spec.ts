import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  accounts,
  applications,
  createAppDb,
  createProvisioningDb,
  environments,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import { WebhookDeliveryStore } from "./webhook-delivery.store.js";
import { WebhooksService } from "./webhooks.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;
const config = {
  get: (key: string) =>
    key === "WEBHOOK_ALLOW_PRIVATE_NETWORKS" ? "true" : undefined,
} as unknown as ConfigService;
const auditRecords: Array<{ action: string; targetId?: string | null }> = [];
const audit = {
  record: async (input: { action: string; targetId?: string | null }) => {
    auditRecords.push(input);
  },
} as unknown as AuditService;

describeDb("durable endpoint-specific webhook delivery", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const appDb = createAppDb(appUrl ?? "");
  const owner = postgres(superUrl ?? "", { max: 1 });
  const webhooks = new WebhooksService(appDb, config, audit);
  const delivery = new WebhookDeliveryService(
    new WebhookDeliveryStore(provisioning),
    config,
  );
  const tenantId = randomUUID() as TenantId;
  const otherTenantId = randomUUID();

  let server: Server;
  let port = 0;
  let applicationId = "";
  let environmentId = "";
  let liveEnvironmentId = "";
  let failingStatus = 500;
  const received: Array<{ path: string; signature: string; body: string }> = [];

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Webhook Test",
      slug: `hook-${tenantId}`,
    });
    const [app] = await provisioning.db
      .insert(applications)
      .values({ tenantId, name: "Default", slug: "default" })
      .returning();
    if (!app) throw new Error("default application seed failed");
    applicationId = app.id;
    const sandboxRows = await provisioning.db
      .insert(environments)
      .values({
        tenantId,
        applicationId: app.id,
        type: "sandbox",
        status: "active",
      })
      .returning();
    const [live] = await provisioning.db
      .insert(environments)
      .values({
        tenantId,
        applicationId: app.id,
        type: "live",
        status: "active",
      })
      .returning();
    if (!live) throw new Error("live environment seed failed");
    liveEnvironmentId = live.id;
    const sandbox = sandboxRows[0];
    if (!sandbox) throw new Error("sandbox environment seed failed");
    environmentId = sandbox.id;

    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const path = request.url ?? "";
        received.push({
          path,
          signature: String(request.headers["fabric-signature"] ?? ""),
          body,
        });
        response.statusCode = path === "/failing" ? failingStatus : 200;
        response.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("listener has no port");
    port = address.port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await owner`DELETE FROM outbox_events WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM webhook_endpoints WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  async function emit(payload: Record<string, unknown>): Promise<string> {
    return appDb.withTenant(tenantId, async (tx) => {
      const rows = await tx`
        INSERT INTO outbox_events (
          tenant_id, application_id, environment_id, event_type, payload
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${applicationId},
          ${environmentId}, 'message.updated', ${JSON.stringify(payload)}::jsonb
        ) RETURNING id`;
      return String(rows[0]?.id);
    });
  }

  it("rolls back an outbox event with its domain transaction", async () => {
    await expect(
      appDb.withTenant(tenantId, async (tx) => {
        await tx`
          INSERT INTO outbox_events (tenant_id, event_type, payload)
          VALUES (current_setting('app.tenant_id')::uuid, 'message.updated', '{}')`;
        throw new Error("domain write failed");
      }),
    ).rejects.toThrow("domain write failed");
  });

  it("confines runtime-key webhook management to the key's exact environment", async () => {
    const liveEndpoint = await webhooks.create(
      tenantId,
      { url: `http://127.0.0.1:${port}/live` },
      { environmentId: liveEnvironmentId },
    );
    expect(
      (await webhooks.list(tenantId, undefined, environmentId)).map(
        (endpoint) => endpoint.id,
      ),
    ).not.toContain(liveEndpoint.id);
    expect(
      (await webhooks.list(tenantId, undefined, liveEnvironmentId)).map(
        (endpoint) => endpoint.id,
      ),
    ).toContain(liveEndpoint.id);
    await expect(
      webhooks.disable(tenantId, liveEndpoint.id, environmentId),
    ).rejects.toMatchObject({
      response: { error: { code: "webhook_not_found" } },
    });
    await webhooks.disable(tenantId, liveEndpoint.id, liveEnvironmentId);
  });

  it("applies an application filter and the key's environment scope together", async () => {
    // The environment scope must NARROW the application filter, never replace it. When it replaced
    // it, asking for a different application returned this one's endpoints: the response answered
    // a question the caller had not asked.
    const endpoint = await webhooks.create(
      tenantId,
      { url: `http://127.0.0.1:${port}/scoped` },
      { applicationId, environmentId },
    );
    expect(
      (await webhooks.list(tenantId, applicationId, environmentId)).map(
        (row) => row.id,
      ),
    ).toContain(endpoint.id);
    expect(
      await webhooks.list(
        tenantId,
        "00000000-0000-4000-8000-0000000000ff",
        environmentId,
      ),
    ).toEqual([]);
    await webhooks.disable(tenantId, endpoint.id, environmentId);
  });

  it("signs events and retries only the failed endpoint", async () => {
    const healthy = await webhooks.create(tenantId, {
      url: `http://127.0.0.1:${port}/healthy`,
    });
    const failing = await webhooks.create(tenantId, {
      url: `http://127.0.0.1:${port}/failing`,
    });
    const eventId = await emit({ message_id: "message-1", status: "accepted" });

    const first = await delivery.deliverPending();
    expect(first).toMatchObject({ claimed: 2, delivered: 1, retried: 1 });
    const healthyRequest = received.find((item) => item.path === "/healthy");
    if (!healthyRequest)
      throw new Error("healthy endpoint received no request");
    const signature = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(
      healthyRequest.signature,
    );
    if (!signature) throw new Error("signature format is invalid");
    expect(
      createHmac("sha256", healthy.secret)
        .update(`${signature[1]}.${healthyRequest.body}`)
        .digest("hex"),
    ).toBe(signature[2]);
    expect(JSON.parse(healthyRequest.body)).toMatchObject({
      id: eventId,
      type: "message.sent",
    });

    const healthyCalls = received.filter(
      (item) => item.path === "/healthy",
    ).length;
    await owner`
      UPDATE webhook_deliveries SET next_attempt_at = now()
      WHERE endpoint_id = ${failing.id} AND state = 'pending'`;
    const second = await delivery.deliverPending();
    expect(second).toMatchObject({ claimed: 1, delivered: 0, retried: 1 });
    expect(received.filter((item) => item.path === "/healthy")).toHaveLength(
      healthyCalls,
    );
  });

  it("keeps dead evidence, audits replay, and continues the attempt history", async () => {
    const endpoints = await webhooks.list(tenantId);
    const failing = endpoints.find((item) => item.url.endsWith("/failing"));
    if (!failing) throw new Error("failing endpoint is missing");

    for (let attempt = 2; attempt < 10; attempt++) {
      await owner`
        UPDATE webhook_deliveries SET next_attempt_at = now()
        WHERE endpoint_id = ${failing.id} AND state = 'pending'`;
      await delivery.deliverPending();
    }
    const deadPage = await webhooks.listDeliveries(
      tenantId,
      failing.id,
      "dead",
      {
        limit: 50,
      },
    );
    const dead = deadPage.deliveries[0];
    expect(dead?.attempts).toBe(10);
    if (!dead) throw new Error("delivery did not reach dead state");

    await expect(
      webhooks.replay(otherTenantId, failing.id, dead.id, "other-key"),
    ).rejects.toMatchObject({
      response: { error: { code: "webhook_delivery_not_replayable" } },
    });
    expect(
      (
        await webhooks.listDeliveries(otherTenantId, failing.id, undefined, {
          limit: 50,
        })
      ).deliveries,
    ).toEqual([]);

    const replayed = await webhooks.replay(
      tenantId,
      failing.id,
      dead.id,
      "owner-key",
    );
    expect(replayed.state).toBe("pending");
    expect(auditRecords.at(-1)).toMatchObject({
      action: "webhook_delivery.replay",
      targetId: dead.id,
    });
    failingStatus = 200;
    await owner`
      UPDATE webhook_deliveries SET next_attempt_at = now()
      WHERE id = ${dead.id}`;
    expect(await delivery.deliverPending()).toMatchObject({ delivered: 1 });
    const attempts = await owner`
      SELECT outcome FROM webhook_delivery_attempts
      WHERE delivery_id = ${dead.id} ORDER BY attempt_number`;
    expect(attempts).toHaveLength(11);
    expect(attempts.at(-1)?.outcome).toBe("delivered");
  });

  it("recovers an expired lease and soft-disables without losing history", async () => {
    const endpoints = await webhooks.list(tenantId);
    const healthy = endpoints.find((item) => item.url.endsWith("/healthy"));
    if (!healthy) throw new Error("healthy endpoint is missing");
    const eventId = await emit({
      message_id: "message-lease",
      status: "delivered",
    });
    await owner`
      INSERT INTO webhook_deliveries (
        tenant_id, application_id, environment_id, event_id, endpoint_id,
        state, attempts, cycle_attempts, lease_expires_at
      ) VALUES (
        ${tenantId}, ${applicationId}, ${environmentId}, ${eventId}, ${healthy.id},
        'delivering', 1, 1, now() - interval '1 minute'
      )`;
    expect(await delivery.deliverPending()).toMatchObject({ claimed: 2 });

    await webhooks.disable(tenantId, healthy.id);
    const listed = await webhooks.list(tenantId);
    expect(listed.find((item) => item.id === healthy.id)?.status).toBe(
      "disabled",
    );
    expect(
      (
        await webhooks.listDeliveries(tenantId, healthy.id, undefined, {
          limit: 50,
        })
      ).deliveries,
    ).not.toEqual([]);
  });

  it("exposes only secret prefixes and rejects private URLs by default", async () => {
    const endpoints = await webhooks.list(tenantId);
    for (const endpoint of endpoints) {
      expect((endpoint as { secret?: string }).secret).toBeUndefined();
      expect(endpoint.secret_prefix.length).toBeLessThan(15);
      expect(endpoint.health.pending).toBeGreaterThanOrEqual(0);
    }
    const strict = new WebhooksService(
      appDb,
      { get: () => undefined } as unknown as ConfigService,
      audit,
    );
    await expect(
      strict.create(tenantId, {
        url: "http://169.254.169.254/latest/meta-data",
      }),
    ).rejects.toMatchObject({
      response: { error: { code: "webhook_https_required" } },
    });
  });
});

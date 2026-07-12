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
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import { WebhooksService } from "./webhooks.service.js";

/**
 * OUTBOX + WEBHOOK DELIVERY — integration spec (finding 8). Real Postgres + a real local HTTP
 * receiver. Proves:
 *   1. atomicity: an outbox insert rolls back WITH its transaction (no event for a write that
 *      didn't happen);
 *   2. delivery: the sweep POSTs a correctly HMAC-signed envelope to the registered endpoint and
 *      marks the event delivered;
 *   3. retry + dead-letter: a 500ing endpoint bumps attempts (not delivered); attempts exhaust
 *      into a dead row rather than grinding forever;
 *   4. secrecy: list() exposes only the secret prefix.
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

const config = {
  get: () => undefined,
} as unknown as ConfigService;

describeDb("transactional outbox + signed webhook delivery", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const appDb = createAppDb(appUrl ?? "");
  const owner = postgres(superUrl ?? "", { max: 1 });
  const webhooks = new WebhooksService(appDb);
  const delivery = new WebhookDeliveryService(provisioning, config);

  const tenantId = randomUUID() as TenantId;

  // Local receiver: records signed requests; response code is switchable per test.
  let server: Server;
  let port = 0;
  let respondWith = 200;
  const received: Array<{ signature: string; body: string }> = [];

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Webhook Test",
      slug: `hook-${tenantId}`,
    });
    // ADR-0004: webhooks.create mints into the default app's sandbox env, so seed that hierarchy.
    const [app] = await provisioning.db
      .insert(applications)
      .values({ tenantId, name: "Default", slug: "default" })
      .returning();
    if (!app)
      throw new Error("seed: default application insert returned no row");
    await provisioning.db.insert(environments).values([
      { tenantId, applicationId: app.id, type: "sandbox", status: "active" },
      { tenantId, applicationId: app.id, type: "live", status: "active" },
    ]);
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        received.push({
          signature: String(req.headers["fabric-signature"] ?? ""),
          body,
        });
        res.statusCode = respondWith;
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("listener has no port");
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await owner`DELETE FROM outbox_events WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM webhook_endpoints WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  async function emitEvent(payload: Record<string, unknown>): Promise<void> {
    await appDb.withTenant(tenantId, async (tx) => {
      await tx`
        INSERT INTO outbox_events (tenant_id, event_type, payload)
        VALUES (current_setting('app.tenant_id')::uuid, 'message.updated', ${JSON.stringify(payload)}::jsonb)`;
    });
  }

  async function undeliveredCount(): Promise<number> {
    const rows = await owner`
      SELECT count(*)::int AS n FROM outbox_events
      WHERE tenant_id = ${tenantId} AND delivered_at IS NULL`;
    return Number(rows[0]?.n);
  }

  it("outbox insert rolls back with its transaction (atomicity)", async () => {
    const before = await undeliveredCount();
    await expect(
      appDb.withTenant(tenantId, async (tx) => {
        await tx`
          INSERT INTO outbox_events (tenant_id, event_type, payload)
          VALUES (current_setting('app.tenant_id')::uuid, 'message.updated', '{"x":1}'::jsonb)`;
        throw new Error("boom — the domain write failed");
      }),
    ).rejects.toThrow("boom");
    expect(await undeliveredCount()).toBe(before);
  });

  it("delivers a signed envelope to the registered endpoint and marks the event delivered", async () => {
    const created = await webhooks.create(tenantId, {
      url: `http://127.0.0.1:${port}/hooks`,
    });
    expect(created.secret.startsWith("whsec_")).toBe(true);

    respondWith = 200;
    await emitEvent({ message_id: "m-1", status: "accepted" });
    const result = await delivery.deliverPending();
    expect(result.locked).toBe(true);
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    expect(await undeliveredCount()).toBe(0);

    const last = received.at(-1);
    expect(last).toBeDefined();
    if (!last) throw new Error("no request received");
    // Verify the signature exactly as a consumer would.
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(last.signature);
    expect(match).not.toBeNull();
    if (!match) throw new Error("bad signature format");
    const expected = createHmac("sha256", created.secret)
      .update(`${match[1]}.${last.body}`)
      .digest("hex");
    expect(match[2]).toBe(expected);
    const envelope = JSON.parse(last.body) as {
      type: string;
      data: { message_id: string };
    };
    expect(envelope.type).toBe("message.updated");
    expect(envelope.data.message_id).toBe("m-1");
  });

  it("a failing endpoint bumps attempts and retries; exhausted attempts dead-letter", async () => {
    respondWith = 500;
    await emitEvent({ message_id: "m-2", status: "failed" });

    const first = await delivery.deliverPending();
    expect(first.retried).toBeGreaterThanOrEqual(1);
    expect(await undeliveredCount()).toBe(1);

    // Exhaust the remaining attempts — the row must retire dead, not spin forever.
    for (let i = 0; i < 9; i++) {
      await delivery.deliverPending();
    }
    expect(await undeliveredCount()).toBe(0); // dead-lettered (delivered_at set)
    const [row] = await owner`
      SELECT attempts FROM outbox_events
      WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`;
    expect(Number(row?.attempts)).toBe(10);
    respondWith = 200;
  });

  it("list() exposes only the secret prefix", async () => {
    const endpoints = await webhooks.list(tenantId);
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    for (const e of endpoints) {
      expect(e.secret_prefix.length).toBeLessThan(15);
      expect(JSON.stringify(e)).not.toContain("whsec_".padEnd(20, "x"));
      expect((e as { secret?: string }).secret).toBeUndefined();
    }
  });

  it("endpoints carry their environment (ADR-0004): a live endpoint reports env 'live'", async () => {
    const live = await webhooks.create(
      tenantId,
      { url: "https://example.com/live-hook" },
      { envType: "live" },
    );
    expect(live.env).toBe("live");
    const endpoints = await webhooks.list(tenantId);
    const found = endpoints.find((e) => e.id === live.id);
    expect(found?.env).toBe("live");
    // The default-sandbox endpoint from earlier still reports 'sandbox'.
    expect(endpoints.some((e) => e.env === "sandbox")).toBe(true);
  });
});

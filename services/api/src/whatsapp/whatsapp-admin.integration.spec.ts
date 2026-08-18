import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { unwrapEnvelope } from "@app/contracts";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { WhatsappTemplateSyncScheduler } from "./whatsapp-template-sync.scheduler.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const describeDb = SUPER_URL ? describe : describe.skip;
const BFF_TOKEN = "whatsapp-admin-bff-token";

process.env.BFF_INTERNAL_TOKEN = BFF_TOKEN;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

/**
 * The on-demand template sync. The scheduler is STUBBED throughout: this route deliberately runs
 * unfiltered, so letting it through would fan a catalog across every discoverable tenant of whatever
 * database the suite points at, including real workspaces on a developer machine. The fan-out is
 * covered by whatsapp-templates.integration.spec.ts; what this route owes is the guard, the
 * delegation and the audit trail.
 */
describeDb("WhatsApp admin template sync", () => {
  const owner = postgres(SUPER_URL ?? "", { max: 1 });
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false, rawBody: true },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    // No cleanup, deliberately. audit_events is global and append-only — app_runtime holds no DELETE
    // on it — and the earlier `DELETE ... WHERE action = ...` here was unscoped, so running this
    // suite against a database an operator had used would erase the very trail the route exists to
    // leave. audit.integration.spec.ts states the same rule. Assertions below scope by a per-run
    // actor instead.
    await owner.end();
  });

  it("refuses without the BFF token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/admin/whatsapp/template-sync",
    });
    expect(response.statusCode).toBe(401);
  });

  // The first operator use is exactly when this breaks — an unarmed credential throws before
  // anything syncs — and the audit used to be written only after a successful run, so the one
  // attempt anybody would want to trace left nothing behind.
  it("records the attempt even when the sync fails", async () => {
    const actor = `ops+${randomUUID().slice(0, 8)}@fabric.dev`;
    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    const original = scheduler.run.bind(scheduler);
    Object.assign(scheduler, {
      run: async () => {
        throw new Error("live_whatsapp_not_configured");
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/admin/whatsapp/template-sync",
        headers: { "x-bff-token": BFF_TOKEN, "x-actor-email": actor },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      Object.assign(scheduler, { run: original });
    }

    const [event] = await owner`
      SELECT actor_email, summary FROM audit_events
      WHERE action = 'whatsapp.template_sync.run' AND actor_email = ${actor}`;
    expect(event).toMatchObject({
      actor_email: actor,
      summary: "WhatsApp template sync failed.",
    });
  });

  it("runs the sync and records who asked for it", async () => {
    // Unique per run, so the assertion cannot match a row left by an earlier run or a real operator.
    const actor = `ops+${randomUUID().slice(0, 8)}@fabric.dev`;
    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    const original = scheduler.run.bind(scheduler);
    Object.assign(scheduler, {
      run: async () => ({ locked: true, synced: 7, tenants: 1, failed: 0 }),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/admin/whatsapp/template-sync",
        headers: {
          "x-bff-token": BFF_TOKEN,
          "x-actor-email": actor,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(unwrapEnvelope(response.json())).toMatchObject({
        locked: true,
        synced: 7,
      });
    } finally {
      Object.assign(scheduler, { run: original });
    }

    const [event] = await owner`
      SELECT actor_email, summary, metadata FROM audit_events
      WHERE action = 'whatsapp.template_sync.run' AND actor_email = ${actor}`;
    expect(event).toMatchObject({
      actor_email: actor,
      summary: "Synced WhatsApp templates for 7 record(s).",
    });
  });
});

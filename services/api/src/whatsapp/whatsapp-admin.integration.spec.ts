import "reflect-metadata";
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
    await owner`DELETE FROM audit_events WHERE action = 'whatsapp.template_sync.run'`;
    await owner.end();
  });

  it("refuses without the BFF token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/admin/whatsapp/template-sync",
    });
    expect(response.statusCode).toBe(401);
  });

  it("runs the sync and records who asked for it", async () => {
    const scheduler = app.get(WhatsappTemplateSyncScheduler);
    const original = scheduler.run.bind(scheduler);
    Object.assign(scheduler, {
      run: async () => ({ locked: true, synced: 7 }),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/admin/whatsapp/template-sync",
        headers: {
          "x-bff-token": BFF_TOKEN,
          "x-actor-email": "ops@fabric.dev",
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ locked: true, synced: 7 });
    } finally {
      Object.assign(scheduler, { run: original });
    }

    const [event] = await owner`
      SELECT actor_email, summary FROM audit_events
      WHERE action = 'whatsapp.template_sync.run'
      ORDER BY created_at DESC LIMIT 1`;
    expect(event).toMatchObject({ actor_email: "ops@fabric.dev" });
  });
});

// ============================================================================================
// REQUEST LOGS (W-B) against a real migrated DB + RLS. Proves: list() reads a tenant's logs
// keyset-paginated, scoped to an application + environment, with the env joined; record() FAILS
// OPEN (a bad write never throws to the caller); the retention sweep deletes aged rows and spares
// fresh ones. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import {
  type ApplicationId,
  createAppDb,
  createProvisioningDb,
  type EnvironmentId,
  requestLogs,
  type TenantId,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailService } from "../email/email.service.js";
import { MaintenanceService } from "../maintenance/maintenance.service.js";
import type { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { RequestLogService } from "./request-log.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const provisioning = createProvisioningDb(SUPER_URL ?? "", { max: 1 });
const appDb = createAppDb(APP_URL ?? "", { max: 1 });
const svc = new RequestLogService(appDb, provisioning);

const TENANT = randomUUID();
let sandboxEnvId = "";
let liveEnvId = "";
let appId = "";

async function seedLog(
  environmentId: string,
  path: string,
  status: number,
): Promise<void> {
  await provisioning.db.insert(requestLogs).values({
    tenantId: TENANT as TenantId,
    applicationId: appId as ApplicationId,
    environmentId: environmentId as EnvironmentId,
    method: "POST",
    path,
    statusCode: status,
    requestId: `req_${randomUUID().slice(0, 8)}`,
    latencyMs: 12,
    keyId: "abcdef0123456789",
  });
}

describeDb("request logs (real RLS)", () => {
  beforeAll(async () => {
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Logs T', 'logs-t') ON CONFLICT (id) DO NOTHING",
      [TENANT],
    );
    const apps = (await owner.unsafe(
      `INSERT INTO applications (tenant_id, name, slug) VALUES ($1, 'Default', 'default')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
      [TENANT],
    )) as unknown as Array<{ id: string }>;
    appId = apps[0]?.id ?? "";
    const sb = (await owner.unsafe(
      `INSERT INTO environments (tenant_id, application_id, type, status)
       VALUES ($1, $2, 'sandbox', 'active')
       ON CONFLICT (application_id, type) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [TENANT, appId],
    )) as unknown as Array<{ id: string }>;
    sandboxEnvId = sb[0]?.id ?? "";
    const lv = (await owner.unsafe(
      `INSERT INTO environments (tenant_id, application_id, type, status)
       VALUES ($1, $2, 'live', 'active')
       ON CONFLICT (application_id, type) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [TENANT, appId],
    )) as unknown as Array<{ id: string }>;
    liveEnvId = lv[0]?.id ?? "";
  });

  afterAll(async () => {
    await svc.onModuleDestroy();
    await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
    await appDb.end();
    await provisioning.end();
    await owner.end();
  });

  it("record() fails open — a bad write never throws to the caller", () => {
    // No such tenant → FK violation on the async insert; record() must return void without throwing.
    expect(() =>
      svc.record({
        tenantId: randomUUID(),
        applicationId: null,
        environmentId: null,
        method: "POST",
        path: "/v1/sms/send",
        statusCode: 201,
        requestId: "req_x",
        latencyMs: 1,
        keyId: "deadbeefdeadbeef",
      }),
    ).not.toThrow();
  });

  it("lists a tenant's logs scoped to an environment, with env joined", async () => {
    await seedLog(sandboxEnvId, "/v1/sms/send", 201);
    await seedLog(liveEnvId, "/v1/sms/send", 201);

    const sandbox = await svc.list(TENANT, {
      applicationId: appId,
      envType: "sandbox",
    });
    expect(sandbox.logs.length).toBe(1);
    expect(sandbox.logs[0]?.env).toBe("sandbox");
    expect(sandbox.logs[0]?.path).toBe("/v1/sms/send");

    const live = await svc.list(TENANT, {
      applicationId: appId,
      envType: "live",
    });
    expect(live.logs.every((l) => l.env === "live")).toBe(true);
  });

  it("keyset-paginates newest-first", async () => {
    for (let i = 0; i < 3; i++) await seedLog(sandboxEnvId, `/v1/p/${i}`, 200);
    const first = await svc.list(TENANT, { applicationId: appId, limit: 2 });
    expect(first.logs.length).toBe(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await svc.list(TENANT, {
      applicationId: appId,
      limit: 2,
      ...(first.next_cursor ? { cursor: first.next_cursor } : {}),
    });
    // No overlap between pages (keyset, stable).
    const firstIds = new Set(first.logs.map((l) => l.id));
    expect(second.logs.every((l) => !firstIds.has(l.id))).toBe(true);
  });

  it("retention sweep deletes aged rows and spares fresh ones", async () => {
    const config = {
      get: (k: string) =>
        k === "REQUEST_LOG_RETENTION_DAYS"
          ? "30"
          : k === "MAINTENANCE_CRON_ENABLED"
            ? "false"
            : undefined,
    } as unknown as ConfigService;
    const maintenance = new MaintenanceService(
      provisioning,
      {} as SmsService,
      {} as EmailService,
      { purgeExpired: async () => 0 } as unknown as VirtualPhoneService,
      config,
    );
    // Backdate one row well past the window.
    const [aged] = (await owner.unsafe(
      `INSERT INTO request_logs (tenant_id, application_id, environment_id, method, path, status_code, request_id, latency_ms, key_id, created_at)
       VALUES ($1,$2,$3,'GET','/v1/old',200,'req_old',5,'k', now() - interval '90 days') RETURNING id`,
      [TENANT, appId, sandboxEnvId],
    )) as unknown as Array<{ id: string }>;

    const result = await maintenance.runLogRetention();
    expect(result.locked).toBe(true);
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const stillThere = (await owner.unsafe(
      "SELECT id FROM request_logs WHERE id = $1",
      [aged?.id ?? ""],
    )) as unknown as Array<{ id: string }>;
    expect(stillThere.length).toBe(0);
    // Fresh rows from earlier tests survive.
    const fresh = await svc.list(TENANT, { applicationId: appId });
    expect(fresh.logs.length).toBeGreaterThanOrEqual(1);
  });
});

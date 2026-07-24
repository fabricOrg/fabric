// ============================================================================================
// MESSAGING INSIGHTS (Messages → Insights) against a real migrated DB + RLS. Proves the rollup is
// REAL and tenant-safe: counts/averages come from `messages`, another tenant's rows never leak in,
// the environment predicate narrows (and null rolls the workspace up), and error codes are grouped
// newest-heaviest with UNKNOWN codes falling back to the raw code — the guard against reintroducing
// the fabricated Twilio-shaped descriptions this endpoint replaced (#153). tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MessagingInsightsService } from "./messaging-insights.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const appDb = createAppDb(APP_URL ?? "", { max: 1 });
const svc = new MessagingInsightsService(appDb);

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
let sandboxEnvId = "";
let liveEnvId = "";
let otherEnvId = "";

async function seedTenant(
  tenantId: string,
  slug: string,
): Promise<{ appId: string; sandbox: string; live: string }> {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [tenantId, `Insights ${slug}`, slug],
  );
  const apps = (await owner.unsafe(
    `INSERT INTO applications (tenant_id, name, slug) VALUES ($1, 'Default', 'default')
     ON CONFLICT (tenant_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [tenantId],
  )) as unknown as Array<{ id: string }>;
  const appId = apps[0]?.id ?? "";
  const envIds: Record<string, string> = {};
  for (const type of ["sandbox", "live"]) {
    const rows = (await owner.unsafe(
      `INSERT INTO environments (tenant_id, application_id, type, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (application_id, type) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [tenantId, appId, type],
    )) as unknown as Array<{ id: string }>;
    envIds[type] = rows[0]?.id ?? "";
  }
  return {
    appId,
    sandbox: envIds.sandbox ?? "",
    live: envIds.live ?? "",
  };
}

async function seedMessage(opts: {
  tenantId: string;
  environmentId: string;
  status: string;
  segments: number;
  errorCode?: string;
}): Promise<void> {
  await owner.unsafe(
    `INSERT INTO messages
       (tenant_id, environment_id, sender_id, status, encoding, segments, cost_minor, currency, error_code)
     VALUES ($1, $2, 'Fabric', $3, 'gsm7', $4, 1000, 'GHS', $5)`,
    [
      opts.tenantId,
      opts.environmentId,
      opts.status,
      opts.segments,
      opts.errorCode ?? null,
    ],
  );
}

describeDb("messaging insights (real RLS rollup)", () => {
  beforeAll(async () => {
    const mine = await seedTenant(TENANT, `insights-${TENANT.slice(0, 8)}`);
    sandboxEnvId = mine.sandbox;
    liveEnvId = mine.live;
    const theirs = await seedTenant(
      OTHER_TENANT,
      `insights-other-${OTHER_TENANT.slice(0, 8)}`,
    );
    otherEnvId = theirs.sandbox;

    // Sandbox: 2 delivered (1 + 3 segments), 1 undelivered, 1 failed with a known code.
    await seedMessage({
      tenantId: TENANT,
      environmentId: sandboxEnvId,
      status: "delivered",
      segments: 1,
    });
    await seedMessage({
      tenantId: TENANT,
      environmentId: sandboxEnvId,
      status: "delivered",
      segments: 3,
    });
    await seedMessage({
      tenantId: TENANT,
      environmentId: sandboxEnvId,
      status: "undelivered",
      segments: 2,
      errorCode: "virtual_carrier_rejected",
    });
    await seedMessage({
      tenantId: TENANT,
      environmentId: sandboxEnvId,
      status: "failed",
      segments: 2,
      errorCode: "virtual_carrier_rejected",
    });
    // Live: one expired carrying an error code the description map does not know.
    await seedMessage({
      tenantId: TENANT,
      environmentId: liveEnvId,
      status: "expired",
      segments: 2,
      errorCode: "some_unmapped_provider_code",
    });
    // Another tenant's traffic must never appear in our rollup.
    for (let i = 0; i < 5; i++) {
      await seedMessage({
        tenantId: OTHER_TENANT,
        environmentId: otherEnvId,
        status: "delivered",
        segments: 9,
      });
    }
  });

  afterAll(async () => {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      await owner.unsafe("DELETE FROM messages WHERE tenant_id = $1", [tenant]);
      await owner.unsafe("DELETE FROM environments WHERE tenant_id = $1", [
        tenant,
      ]);
      await owner.unsafe("DELETE FROM applications WHERE tenant_id = $1", [
        tenant,
      ]);
      await owner.unsafe("DELETE FROM accounts WHERE id = $1", [tenant]);
    }
    await appDb.end();
    await owner.end();
  });

  it("rolls the whole workspace up when no environment is named", async () => {
    const summary = await svc.summary(TENANT);
    // 4 sandbox + 1 live; the other tenant's 5 delivered rows are excluded by RLS.
    expect(summary.total_sent).toBe(5);
    expect(summary.delivered).toBe(2);
    // undelivered + failed + expired
    expect(summary.failed).toBe(3);
    expect(summary.avg_segments).toBeCloseTo((1 + 3 + 2 + 2 + 2) / 5, 5);
  });

  it("narrows to a single environment", async () => {
    const sandbox = await svc.summary(TENANT, sandboxEnvId);
    expect(sandbox.total_sent).toBe(4);
    expect(sandbox.delivered).toBe(2);
    expect(sandbox.failed).toBe(2);

    const live = await svc.summary(TENANT, liveEnvId);
    expect(live.total_sent).toBe(1);
    expect(live.delivered).toBe(0);
    expect(live.failed).toBe(1);
  });

  it("groups error codes heaviest-first and never fabricates a description", async () => {
    const summary = await svc.summary(TENANT);
    expect(summary.errors.length).toBe(2);

    const [top, next] = summary.errors;
    expect(top?.code).toBe("virtual_carrier_rejected");
    expect(top?.count).toBe(2);
    expect(top?.description).toBe(
      "Carrier rejected the message (virtual phone).",
    );

    // An unmapped code falls back to the raw code — never a invented provider-style sentence.
    expect(next?.code).toBe("some_unmapped_provider_code");
    expect(next?.count).toBe(1);
    expect(next?.description).toBe("some_unmapped_provider_code");
  });

  it("reports an honest zero rollup for a tenant with no traffic", async () => {
    const empty = randomUUID();
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Insights Empty', $2)",
      [empty, `insights-empty-${empty.slice(0, 8)}`],
    );
    try {
      const summary = await svc.summary(empty);
      expect(summary).toMatchObject({
        total_sent: 0,
        delivered: 0,
        failed: 0,
        avg_segments: 0,
      });
      expect(summary.errors).toEqual([]);
    } finally {
      await owner.unsafe("DELETE FROM accounts WHERE id = $1", [empty]);
    }
  });
});

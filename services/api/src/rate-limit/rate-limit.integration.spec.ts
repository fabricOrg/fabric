import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterAll, describe, expect, it } from "vitest";
import { RateLimitService } from "./rate-limit.service.js";

/**
 * TOKEN-BUCKET RATE LIMIT — integration spec (finding 6). Real Redis (docker-compose redis-queue,
 * same one CI boots). Proves: burst up to capacity then 429; refill re-admits; the tenant
 * aggregate stops many-keys quota-dodging; store failure and no-store both fail OPEN.
 */

const redisUrl = process.env.REDIS_QUEUE_URL ?? "redis://localhost:6379";

function service(values: Record<string, string>): RateLimitService {
  return new RateLimitService({
    get: (k: string) => values[k],
  } as unknown as ConfigService);
}

function is429(e: unknown): boolean {
  return e instanceof HttpException && e.getStatus() === 429;
}

describe("RateLimitService (token bucket)", () => {
  const services: RateLimitService[] = [];
  function track(s: RateLimitService): RateLimitService {
    services.push(s);
    return s;
  }
  afterAll(async () => {
    await Promise.all(services.map((s) => s.onModuleDestroy()));
  });

  it("admits a burst up to capacity, rejects the next, refills over time", async () => {
    // 60/min → capacity 60, refill 1 token/second.
    const svc = track(
      service({
        REDIS_QUEUE_URL: redisUrl,
        RATE_LIMIT_PER_KEY_PER_MINUTE: "60",
        RATE_LIMIT_PER_TENANT_PER_MINUTE: "0", // isolate the key bucket
      }),
    );
    const keyId = `k-${randomUUID()}`;
    const tenantId = `t-${randomUUID()}`;

    for (let i = 0; i < 60; i++) {
      await svc.consume(keyId, tenantId); // full burst headroom
    }
    await expect(svc.consume(keyId, tenantId)).rejects.toSatisfy(is429);

    // ~1 token refills per second — after 1.2s exactly one more request clears.
    await new Promise((r) => setTimeout(r, 1_200));
    await svc.consume(keyId, tenantId);
    await expect(svc.consume(keyId, tenantId)).rejects.toSatisfy(is429);
  });

  it("tenant aggregate stops quota-dodging via many keys", async () => {
    const svc = track(
      service({
        REDIS_QUEUE_URL: redisUrl,
        RATE_LIMIT_PER_KEY_PER_MINUTE: "1000", // key bucket irrelevant here
        RATE_LIMIT_PER_TENANT_PER_MINUTE: "3",
      }),
    );
    const tenantId = `t-${randomUUID()}`;

    // 3 requests spread across 3 DIFFERENT keys drain the tenant bucket…
    for (let i = 0; i < 3; i++) {
      await svc.consume(`k-${randomUUID()}`, tenantId);
    }
    // …so a FOURTH key still gets the tenant 429.
    await expect(svc.consume(`k-${randomUUID()}`, tenantId)).rejects.toSatisfy(
      is429,
    );
  });

  it("fails OPEN when the store is unreachable", async () => {
    const svc = track(
      service({
        REDIS_QUEUE_URL: "redis://127.0.0.1:59999", // nothing listens here
        RATE_LIMIT_PER_KEY_PER_MINUTE: "1",
      }),
    );
    // Limit is 1/min but the store is down — both must pass (availability beats throttling).
    await svc.consume("k-down", "t-down");
    await svc.consume("k-down", "t-down");
  });

  it("no REDIS_QUEUE_URL → limiting disabled entirely", async () => {
    const svc = track(service({ RATE_LIMIT_PER_KEY_PER_MINUTE: "1" }));
    await svc.consume("k-off", "t-off");
    await svc.consume("k-off", "t-off");
  });
});

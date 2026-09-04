import type { VerifyStartResponse } from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import type { IdempotencyService } from "../idempotency/idempotency.service.js";
import { VerifyController } from "./verify.controller.js";
import type { VerifyService } from "./verify.service.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const STARTED: VerifyStartResponse = {
  id: "00000000-0000-4000-8000-000000000002",
  status: "pending",
  to: "+23354•••7189",
  channel: "sms",
  expires_in: 300,
  expires_at: "2026-08-30T07:05:00.000Z",
  debug_code: "123456",
};

function request(): { tenant: RequestTenant } {
  return {
    tenant: {
      id: TENANT_ID,
      scopes: ["sms:send"],
      keyId: "key_verify",
      applicationId: "00000000-0000-4000-8000-000000000003",
      environmentId: "00000000-0000-4000-8000-000000000004",
      isSessionToken: false,
    },
  };
}

function controllerWith(input?: {
  start?: () => Promise<VerifyStartResponse>;
  begin?: () => Promise<
    { kind: "new" } | { kind: "replay"; response: unknown }
  >;
  complete?: () => Promise<void>;
}) {
  const verify = {
    start: vi.fn(input?.start ?? (async () => STARTED)),
  };
  const idempotency = {
    fingerprint: vi.fn(() => "fingerprint"),
    begin: vi.fn(input?.begin ?? (async () => ({ kind: "new" as const }))),
    complete: vi.fn(input?.complete ?? (async () => undefined)),
    release: vi.fn(async () => undefined),
  };
  return {
    controller: new VerifyController(
      verify as unknown as VerifyService,
      idempotency as unknown as IdempotencyService,
    ),
    verify,
    idempotency,
  };
}

describe("VerifyController idempotency", () => {
  it("replays a completed start without sending another code", async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    const stored = { ...STARTED, expires_at: expiresAt, debug_code: undefined };
    const { controller, verify, idempotency } = controllerWith({
      begin: async () => ({ kind: "replay", response: stored }),
    });

    const replayed = await controller.start(
      request(),
      { to: "+233545227189" },
      "attempt-1",
    );
    expect(replayed).toMatchObject({
      id: STARTED.id,
      status: "pending",
      to: STARTED.to,
      channel: "sms",
      expires_at: expiresAt,
    });
    expect(replayed.debug_code).toBeUndefined();
    expect(verify.start).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it("recomputes the relative expiry on a replay instead of repeating the stored one", async () => {
    // The stored payload keeps the expiry it had at FIRST execution. Handing it back verbatim let a
    // start replayed minutes later still promise 300 seconds on a code with far less left.
    const stored = {
      ...STARTED,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      debug_code: undefined,
    };
    const { controller } = controllerWith({
      begin: async () => ({ kind: "replay", response: stored }),
    });

    const fresh = await controller.start(
      request(),
      { to: "+233545227189" },
      "attempt-1",
    );
    expect(fresh.expires_in).toBeGreaterThan(55);
    expect(fresh.expires_in).toBeLessThanOrEqual(60);
  });

  it("reports a lapsed replay as zero rather than a negative countdown", async () => {
    const { controller } = controllerWith({
      begin: async () => ({
        kind: "replay",
        response: {
          ...STARTED,
          expires_at: new Date(Date.now() - 60_000).toISOString(),
          debug_code: undefined,
        },
      }),
    });

    await expect(
      controller.start(request(), { to: "+233545227189" }, "attempt-1"),
    ).resolves.toMatchObject({ expires_in: 0 });
  });

  it("stores a replay response without the sandbox debug code", async () => {
    const { controller, idempotency } = controllerWith();

    await expect(
      controller.start(request(), { to: "+233545227189" }, "attempt-1"),
    ).resolves.toEqual(STARTED);
    expect(idempotency.complete).toHaveBeenCalledWith(TENANT_ID, "attempt-1", {
      id: STARTED.id,
      status: "pending",
      to: STARTED.to,
      channel: "sms",
      expires_in: 300,
      expires_at: STARTED.expires_at,
    });
  });

  it("releases the claim when the send fails", async () => {
    const failure = new Error("send failed");
    const { controller, idempotency } = controllerWith({
      start: async () => {
        throw failure;
      },
    });

    await expect(
      controller.start(request(), { to: "+233545227189" }, "attempt-1"),
    ).rejects.toBe(failure);
    expect(idempotency.release).toHaveBeenCalledWith(TENANT_ID, "attempt-1");
  });

  it("keeps the claim pending when response persistence fails after acceptance", async () => {
    const failure = new Error("idempotency store unavailable");
    const { controller, idempotency, verify } = controllerWith({
      complete: async () => {
        throw failure;
      },
    });

    await expect(
      controller.start(request(), { to: "+233545227189" }, "attempt-1"),
    ).rejects.toBe(failure);
    expect(verify.start).toHaveBeenCalledOnce();
    expect(idempotency.release).not.toHaveBeenCalled();
  });
});

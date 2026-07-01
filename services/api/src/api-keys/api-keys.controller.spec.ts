import { describe, expect, it, vi } from "vitest";
import { ApiKeysController } from "./api-keys.controller.js";
import type { ApiKeyService } from "./api-keys.service.js";

const TID = "00000000-0000-0000-0000-0000000000a1";

type SvcMocks = {
  create: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
};

function controllerWith(over: Partial<SvcMocks> = {}): {
  ctl: ApiKeysController;
  svc: SvcMocks;
} {
  const svc = {
    create: vi.fn(async () => ({
      id: "k1",
      prefix: "sk_test_ab3d",
      env: "test",
      scopes: [],
      raw: "sk_test_raw",
    })),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => true),
    ...over,
  };
  return {
    ctl: new ApiKeysController(svc as unknown as ApiKeyService),
    svc,
  };
}

describe("ApiKeysController (F2.3 mgmt)", () => {
  it("create: validates + delegates, returns the raw once", async () => {
    const { ctl, svc } = controllerWith();
    const out = await ctl.create({
      tenantId: TID,
      env: "test",
      scopes: ["sms:send"],
    });
    expect(svc.create).toHaveBeenCalledWith(TID, {
      env: "test",
      scopes: ["sms:send"],
    });
    expect(out.raw).toBe("sk_test_raw");
  });

  it("create: 400 invalid_request_error on bad tenantId (param=tenantId)", async () => {
    const { ctl } = controllerWith();
    try {
      await ctl.create({ tenantId: "nope", env: "test" });
      expect.unreachable("should have thrown");
    } catch (e) {
      const ex = e as {
        getStatus(): number;
        getResponse(): { error: { type: string; param?: string } };
      };
      expect(ex.getStatus()).toBe(400);
      expect(ex.getResponse().error.type).toBe("invalid_request_error");
      expect(ex.getResponse().error.param).toBe("tenantId");
    }
  });

  it("create: 400 invalid_request_error on bad env (param=env)", async () => {
    const { ctl } = controllerWith();
    try {
      await ctl.create({ tenantId: TID, env: "prod" });
      expect.unreachable("should have thrown");
    } catch (e) {
      const ex = e as {
        getStatus(): number;
        getResponse(): { error: { type: string; param?: string } };
      };
      expect(ex.getStatus()).toBe(400);
      expect(ex.getResponse().error.type).toBe("invalid_request_error");
      expect(ex.getResponse().error.param).toBe("env");
    }
  });

  it("list: delegates with the validated tenant", async () => {
    const { ctl, svc } = controllerWith();
    await ctl.list(TID);
    expect(svc.list).toHaveBeenCalledWith(TID);
  });

  it("revoke: 404 not_found_error when the key wasn't active", async () => {
    const { ctl } = controllerWith({ revoke: vi.fn(async () => false) });
    try {
      await ctl.revoke(TID, TID);
      expect.unreachable("should have thrown");
    } catch (e) {
      const ex = e as {
        getStatus(): number;
        getResponse(): { error: { type: string } };
      };
      expect(ex.getStatus()).toBe(404);
      expect(ex.getResponse().error.type).toBe("not_found_error");
    }
  });

  it("revoke: returns {revoked:true} on success", async () => {
    const { ctl } = controllerWith();
    await expect(ctl.revoke(TID, TID)).resolves.toEqual({ revoked: true });
  });
});

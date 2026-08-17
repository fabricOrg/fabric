import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "./api-key.guard.js";
import { ApiKeysController } from "./api-keys.controller.js";
import type { ApiKeyService } from "./api-keys.service.js";

const TID = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";

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
      expiresAt: null,
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

/** A request the guard authenticated via a tenant token / sk_* key (customer/dashboard path). */
function sessionReq(tenantId: string): { tenant: RequestTenant } {
  return {
    tenant: {
      id: tenantId,
      scopes: ["*"],
      keyId: `bfft_${tenantId.slice(0, 12)}`,
      applicationId: null,
      environmentId: null,
      isSessionToken: true,
    },
  };
}

describe("ApiKeysController (F2.3 mgmt)", () => {
  describe("customer/session path (req.tenant present)", () => {
    it("create: uses the token's tenant, ignores client tenantId, returns the secret ONCE", async () => {
      const { ctl, svc } = controllerWith();
      const out = await ctl.create(sessionReq(TID), {
        tenantId: OTHER,
        env: "sandbox",
        scopes: ["sms:send"],
        name: "CI",
      });
      expect(svc.create).toHaveBeenCalledWith(TID, {
        env: "test",
        scopes: ["sms:send"],
        name: "CI",
      });
      expect(out.secret).toBe("sk_test_raw");
      expect(out.key).toMatchObject({
        prefix: "sk_test_ab3d",
        env: "sandbox",
        name: "CI",
        status: "active",
      });
    });

    it("create: scopes the key to the given application (application_id)", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.create(sessionReq(TID), {
        name: "CI",
        env: "sandbox",
        scopes: ["sms:send"],
        application_id: OTHER,
      });
      expect(svc.create).toHaveBeenCalledWith(TID, {
        env: "test",
        scopes: ["sms:send"],
        name: "CI",
        applicationId: OTHER,
      });
    });

    it("create: rejects scopes that no endpoint enforces", async () => {
      const { ctl, svc } = controllerWith();
      await expectInvalidRequest(
        () =>
          ctl.create(sessionReq(TID), {
            name: "CI",
            env: "sandbox",
            scopes: ["admin:everything"],
          }),
        "scopes",
      );
      expect(svc.create).not.toHaveBeenCalled();
    });

    it("list: passes the applicationId filter through", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.list(sessionReq(TID), OTHER, OTHER);
      expect(svc.list).toHaveBeenCalledWith(TID, OTHER);
    });

    it("list: serializes the storage-era test value as sandbox", async () => {
      const { ctl } = controllerWith({
        list: vi.fn(async () => [
          {
            id: "k1",
            name: "CI",
            prefix: "sk_test_ab3d",
            env: "test",
            scopes: ["sms:send"],
            status: "active",
            createdAt: "2026-07-15T00:00:00.000Z",
            lastUsedAt: null,
            expiresAt: null,
          },
        ]),
      });
      // Envelope, not a bare array (§11 breaking change) — every sibling list carries request_id.
      await expect(
        ctl.list(sessionReq(TID), undefined, undefined),
      ).resolves.toMatchObject({ keys: [{ env: "sandbox" }] });
    });

    it("list: uses the token's tenant, ignores client tenantId", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.list(sessionReq(TID), OTHER, undefined);
      expect(svc.list).toHaveBeenCalledWith(TID, undefined);
    });

    it("revoke: uses the token's tenant", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.revoke(sessionReq(TID), TID, OTHER);
      expect(svc.revoke).toHaveBeenCalledWith(TID, TID);
    });
  });

  describe("operator path (no req.tenant)", () => {
    it("create: delegates with the operator-supplied tenant", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.create(
        {},
        { name: "CI", tenantId: TID, env: "sandbox", scopes: ["sms:send"] },
      );
      expect(svc.create).toHaveBeenCalledWith(TID, {
        env: "test",
        scopes: ["sms:send"],
        name: "CI",
      });
    });

    it("create: 400 invalid_request_error on a bad tenantId (param=tenantId)", async () => {
      const { ctl } = controllerWith();
      await expectInvalidRequest(
        () =>
          ctl.create(
            {},
            {
              name: "CI",
              env: "sandbox",
              scopes: ["sms:send"],
              tenantId: "nope",
            },
          ),
        "tenantId",
      );
    });

    it("create: 400 invalid_request_error on a bad env (param=env)", async () => {
      const { ctl } = controllerWith();
      await expectInvalidRequest(
        () =>
          ctl.create(
            {},
            {
              name: "CI",
              env: "prod",
              scopes: ["sms:send"],
              tenantId: TID,
            },
          ),
        "env",
      );
    });

    it("list: delegates with the operator-supplied tenant", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.list({}, TID, undefined);
      expect(svc.list).toHaveBeenCalledWith(TID, undefined);
    });
  });

  it("revoke: 404 not_found_error when the key wasn't active", async () => {
    const { ctl } = controllerWith({ revoke: vi.fn(async () => false) });
    try {
      await ctl.revoke(sessionReq(TID), TID, undefined);
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
    await expect(ctl.revoke(sessionReq(TID), TID, undefined)).resolves.toEqual({
      revoked: true,
    });
  });
});

async function expectInvalidRequest(
  run: () => Promise<unknown>,
  param: string,
): Promise<void> {
  try {
    await run();
    expect.unreachable("should have thrown");
  } catch (e) {
    const ex = e as {
      getStatus(): number;
      getResponse(): { error: { type: string; param?: string } };
    };
    expect(ex.getStatus()).toBe(400);
    expect(ex.getResponse().error.type).toBe("invalid_request_error");
    expect(ex.getResponse().error.param).toBe(param);
  }
}

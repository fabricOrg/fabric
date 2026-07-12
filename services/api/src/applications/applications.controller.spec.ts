import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { ApplicationsController } from "./applications.controller.js";
import type { ApplicationsService } from "./applications.service.js";

const TID = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";

type SvcMocks = {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function controllerWith(over: Partial<SvcMocks> = {}): {
  ctl: ApplicationsController;
  svc: SvcMocks;
} {
  const svc = {
    list: vi.fn(async () => ({ applications: [] })),
    create: vi.fn(async () => ({
      id: "app1",
      name: "Checkout",
      slug: "checkout",
      created_at: "2026-07-12T00:00:00.000Z",
      environments: [],
    })),
    ...over,
  };
  return {
    ctl: new ApplicationsController(svc as unknown as ApplicationsService),
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
    },
  };
}

describe("ApplicationsController (ADR-0004 mgmt)", () => {
  describe("customer/session path (req.tenant present)", () => {
    it("list: uses the token's tenant, IGNORES any client-supplied tenantId", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.list(sessionReq(TID), OTHER);
      expect(svc.list).toHaveBeenCalledWith(TID);
    });

    it("create: uses the token's tenant, ignores a client tenantId in the body", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.create(sessionReq(TID), {
        tenantId: OTHER,
        name: "Checkout",
        slug: "checkout",
      });
      expect(svc.create).toHaveBeenCalledWith(TID, {
        name: "Checkout",
        slug: "checkout",
      });
    });
  });

  describe("operator path (no req.tenant)", () => {
    it("list: delegates with the operator-supplied tenant", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.list({}, TID);
      expect(svc.list).toHaveBeenCalledWith(TID);
    });

    it("list: 400 invalid_request_error on a bad tenantId (param=tenantId)", async () => {
      const { ctl } = controllerWith();
      await expectInvalidRequest(() => ctl.list({}, "nope"), "tenantId");
    });

    it("create: delegates with the operator-supplied tenant", async () => {
      const { ctl, svc } = controllerWith();
      await ctl.create(
        {},
        { tenantId: TID, name: "Checkout", slug: "checkout" },
      );
      expect(svc.create).toHaveBeenCalledWith(TID, {
        name: "Checkout",
        slug: "checkout",
      });
    });

    it("create: 400 on a bad tenantId (param=tenantId)", async () => {
      const { ctl } = controllerWith();
      await expectInvalidRequest(
        () => ctl.create({}, { tenantId: "nope", name: "X", slug: "x" }),
        "tenantId",
      );
    });
  });

  it("create: 400 invalid_application on a bad slug (param=slug)", async () => {
    const { ctl } = controllerWith();
    await expectInvalidRequest(
      () =>
        ctl.create(sessionReq(TID), { name: "Checkout", slug: "Bad Slug!" }),
      "slug",
    );
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

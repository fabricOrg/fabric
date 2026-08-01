import type { AppDb } from "@app/db";
import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import type { TokenCatalogService } from "./token-catalog.service.js";
import type { TokenPurchaseService } from "./token-purchase.service.js";
import { TokensController } from "./tokens.controller.js";

const TENANT_ID = "63f523c6-e495-4dd8-bb0d-39b79a511cb3";
const OFFER_VERSION_ID = "273e8b6a-82e8-46e1-86ab-274e458888de";

function tenant(isSessionToken: boolean): RequestTenant {
  return {
    id: TENANT_ID,
    scopes: ["*", "wallet:read"],
    keyId: isSessionToken ? "bfft_session" : "key_customer",
    applicationId: isSessionToken
      ? null
      : "a4265774-d8cf-46b3-be93-41538e06964b",
    environmentId: isSessionToken
      ? null
      : "d15a0785-a58c-4e57-952c-659a5a477bbd",
    isSessionToken,
  };
}

function setup() {
  const initiate = vi.fn(async () => ({ reference: "token-ref" }));
  const catalog = vi.fn(async () => ({ catalog_name: "Offers", offers: [] }));
  const receipt = vi.fn(async () => ({ reference: "token-ref" }));
  const controller = new TokensController(
    { initiate } as unknown as TokenPurchaseService,
    {} as AppDb,
    { catalog, receipt } as unknown as TokenCatalogService,
  );
  return { controller, initiate, catalog, receipt };
}

const body = {
  offer_version_id: OFFER_VERSION_ID,
  pack_count: 2,
  email: "buyer@example.com",
};

describe("TokensController commercial-offer checkout", () => {
  it("derives customer catalog and receipt reads from the session tenant", async () => {
    const { controller, catalog, receipt } = setup();
    await controller.offers({ tenant: tenant(true) });
    await controller.receipt({ tenant: tenant(true) }, "token-ref");
    expect(catalog).toHaveBeenCalledWith(TENANT_ID);
    expect(receipt).toHaveBeenCalledWith(TENANT_ID, "token-ref");
  });

  it("accepts the BFF session-token path and derives the tenant from it", async () => {
    const { controller, initiate } = setup();
    await controller.purchase({ tenant: tenant(true) }, body);
    expect(initiate).toHaveBeenCalledWith(TENANT_ID, body);
  });

  it("rejects customer API keys even when they carry wallet:read", async () => {
    const { controller, initiate } = setup();
    await expect(
      controller.purchase({ tenant: tenant(false) }, body),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof HttpException)) return false;
      const response = error.getResponse() as { error?: { code?: string } };
      return response.error?.code === "token_purchase_requires_session";
    });
    expect(initiate).not.toHaveBeenCalled();
  });
});

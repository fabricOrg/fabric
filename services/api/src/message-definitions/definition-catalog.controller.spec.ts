import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { DefinitionCatalogController } from "./definition-catalog.controller.js";
import type { DefinitionCatalogService } from "./definition-catalog.service.js";

const TENANT: RequestTenant = {
  id: "63f523c6-e495-4dd8-bb0d-39b79a511cb3",
  scopes: ["definitions:read"],
  keyId: "key_catalog",
  applicationId: "273e8b6a-82e8-46e1-86ab-274e458888de",
  environmentId: "a4265774-d8cf-46b3-be93-41538e06964b",
  isSessionToken: false,
};

function setup() {
  const read = vi.fn();
  const controller = new DefinitionCatalogController({
    read,
  } as unknown as DefinitionCatalogService);
  return { controller, read };
}

function errorCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse() as {
        error?: { code?: string };
      };
      return response.error?.code;
    }
  }
  return undefined;
}

describe("DefinitionCatalogController", () => {
  it("passes only the authenticated application/environment context", async () => {
    const { controller, read } = setup();
    read.mockResolvedValue({ definitions: [] });
    await controller.read({ tenant: TENANT });
    expect(read).toHaveBeenCalledWith({
      tenantId: TENANT.id,
      applicationId: TENANT.applicationId,
      environmentId: TENANT.environmentId,
    });
  });

  it("rejects a send-only key", () => {
    const { controller } = setup();
    expect(
      errorCode(() =>
        controller.read({ tenant: { ...TENANT, scopes: ["sms:send"] } }),
      ),
    ).toBe("insufficient_scope");
  });

  it("rejects an unscoped dashboard token", () => {
    const { controller } = setup();
    expect(
      errorCode(() =>
        controller.read({
          tenant: {
            ...TENANT,
            scopes: ["*"],
            applicationId: null,
            environmentId: null,
            isSessionToken: true,
          },
        }),
      ),
    ).toBe("scoped_api_key_required");
  });
});

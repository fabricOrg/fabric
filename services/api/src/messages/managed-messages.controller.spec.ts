import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { encodeCursor } from "../http/cursor.js";
import { ManagedMessagesController } from "./managed-messages.controller.js";
import type { ManagedMessagesService } from "./managed-messages.service.js";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const APPLICATION_ID = "00000000-0000-0000-0000-000000000002";
const ENVIRONMENT_ID = "00000000-0000-0000-0000-000000000003";

function controllerWith() {
  const messages = {
    list: vi.fn(async () => ({ deliveries: [], next_cursor: null })),
  };
  return {
    controller: new ManagedMessagesController(
      messages as unknown as ManagedMessagesService,
    ),
    messages,
  };
}

function request(): { tenant: RequestTenant } {
  return {
    tenant: {
      id: TENANT_ID,
      scopes: ["messages:read"],
      keyId: "key_test",
      applicationId: APPLICATION_ID,
      environmentId: ENVIRONMENT_ID,
      isSessionToken: false,
    },
  };
}

describe("ManagedMessagesController pagination", () => {
  it("parses and passes an opaque cursor to the service", async () => {
    const { controller, messages } = controllerWith();
    const createdAt = "2026-08-13T12:00:00.123456Z";
    const id = "00000000-0000-0000-0000-000000000004";
    const cursor = encodeCursor({ createdAt, id });

    const response = await controller.list(request(), {
      limit: "20",
      cursor,
    });

    expect(messages.list).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      environmentId: ENVIRONMENT_ID,
      page: { limit: 20, before: { createdAt, id } },
    });
    expect(response).toMatchObject({ deliveries: [], next_cursor: null });
    expect(response.request_id).toBeTypeOf("string");
  });

  it("rejects a page size outside the public contract", async () => {
    const { controller, messages } = controllerWith();

    await expect(
      controller.list(request(), { limit: "101" }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "invalid_page", param: "limit" } },
    });
    expect(messages.list).not.toHaveBeenCalled();
  });
});

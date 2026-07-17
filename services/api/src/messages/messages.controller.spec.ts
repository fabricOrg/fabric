import { describe, expect, it, vi } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import type { MessagePreviewService } from "./message-preview.service.js";
import { MessagesController } from "./messages.controller.js";

const TID = "00000000-0000-0000-0000-0000000000a1";

function controllerWith() {
  const svc = {
    preview: vi.fn(async () => ({
      version_id: "00000000-0000-0000-0000-0000000000ff",
      environment: "sandbox" as const,
      resolved_locale: "en",
      blockers: [],
      warnings: [],
      eligible: true,
      sender: { sender_id: "FABRIC", status: "sandbox" as const },
      message_class: "transactional" as const,
      preview: null,
    })),
  };
  return {
    ctl: new MessagesController(svc as unknown as MessagePreviewService),
    svc,
  };
}

function tenant(scopes: string[], environmentId: string | null): RequestTenant {
  return {
    id: TID,
    scopes,
    keyId: "key_x",
    applicationId: null,
    environmentId,
  };
}

describe("MessagesController preview", () => {
  it("passes the key's environment through to the service and stamps a request_id", async () => {
    const { ctl, svc } = controllerWith();
    const res = await ctl.previewMessage(
      { tenant: tenant(["sms:read"], "env-9") },
      { key: "order.shipped", data: { name: "Ada" } },
    );
    expect(svc.preview).toHaveBeenCalledWith(
      TID,
      { key: "order.shipped", data: { name: "Ada" } },
      "env-9",
    );
    expect(res.request_id).toBeTypeOf("string");
  });

  it("requires the sms:read scope", async () => {
    const { ctl, svc } = controllerWith();
    await expect(
      ctl.previewMessage(
        { tenant: tenant(["sms:send"], "env-9") },
        { key: "order.shipped" },
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { error: { code: "insufficient_scope" } },
    });
    expect(svc.preview).not.toHaveBeenCalled();
  });

  it("400s on an invalid preview payload (bad key)", async () => {
    const { ctl } = controllerWith();
    await expect(
      ctl.previewMessage({ tenant: tenant(["*"], null) }, { key: "Bad Key!" }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { type: "invalid_request_error", param: "key" } },
    });
  });
});

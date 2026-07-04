import type { ProvisioningDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { WorkOS } from "@workos-inc/node";
import { describe, expect, it, vi } from "vitest";
import { WorkosWebhookService } from "./workos-webhook.service.js";

const secret = "whsec_test_identity_lifecycle";

function service(workos: WorkOS) {
  const config = {
    get: (name: string) =>
      name === "WORKOS_WEBHOOK_SECRET" ? secret : undefined,
  } as ConfigService;
  return new WorkosWebhookService({} as ProvisioningDb, () => workos, config);
}

describe("WorkOS webhook verification", () => {
  it("accepts an SDK-verified raw payload", async () => {
    const workos = new WorkOS("sk_test_identity_lifecycle");
    const webhooks = service(workos);
    const apply = vi.spyOn(webhooks, "apply").mockResolvedValue();
    const payload = Buffer.from(
      JSON.stringify({
        id: "event_test",
        event: "user.created",
        created_at: "2026-07-04T00:00:00.000Z",
        data: {
          object: "user",
          id: "user_test",
          email: "test@example.com",
          first_name: "Test",
          last_name: "User",
          email_verified: true,
          profile_picture_url: null,
          created_at: "2026-07-04T00:00:00.000Z",
          updated_at: "2026-07-04T00:00:00.000Z",
        },
      }),
    );
    const timestamp = Date.now();
    const hash = await workos.webhooks.computeSignature(
      timestamp,
      payload,
      secret,
    );

    await webhooks.ingest(payload, `t=${timestamp},v1=${hash}`);

    expect(apply).toHaveBeenCalledOnce();
  });

  it("rejects an invalid signature before processing", async () => {
    const webhooks = service(new WorkOS("sk_test_identity_lifecycle"));
    const apply = vi.spyOn(webhooks, "apply");

    await expect(
      webhooks.ingest(Buffer.from("{}"), `t=${Date.now()},v1=invalid`),
    ).rejects.toMatchObject({
      response: { error: { code: "invalid_workos_signature" } },
    });
    expect(apply).not.toHaveBeenCalled();
  });
});

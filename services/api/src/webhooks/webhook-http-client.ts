import { createHmac } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { OutboxEvent } from "@app/db";
import { publicWebhookEventType } from "./webhook-event-type.js";
import { resolveWebhookTarget } from "./webhook-url-policy.js";

export type WebhookPostResult =
  | { readonly ok: true; readonly httpStatus: number }
  | {
      readonly ok: false;
      readonly httpStatus: number | null;
      readonly errorCategory: string;
    };

export async function postWebhook(input: {
  readonly url: string;
  readonly secret: string;
  readonly event: OutboxEvent;
  readonly timeoutMs: number;
  readonly allowPrivateNetworks: boolean;
}): Promise<WebhookPostResult> {
  try {
    const target = await resolveWebhookTarget(
      input.url,
      input.allowPrivateNetworks,
    );
    const body = JSON.stringify({
      id: input.event.id,
      type: publicWebhookEventType(input.event.eventType, input.event.payload),
      created_at: input.event.createdAt.toISOString(),
      data: input.event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", input.secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const transport = target.url.protocol === "https:" ? https : http;

    return await new Promise<WebhookPostResult>((resolve) => {
      let settled = false;
      const finish = (result: WebhookPostResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const request = transport.request(
        target.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "fabric-signature": `t=${timestamp},v1=${signature}`,
          },
          lookup: (_hostname, _options, callback) =>
            callback(null, target.address, target.family),
          timeout: input.timeoutMs,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          // Delivery depends only on the status. Destroy instead of buffering an attacker-sized body.
          response.destroy();
          if (status >= 200 && status < 300) {
            finish({ ok: true, httpStatus: status });
            return;
          }
          finish({
            ok: false,
            httpStatus: status || null,
            errorCategory:
              status >= 400 && status < 500 ? "http_4xx" : "http_5xx",
          });
        },
      );
      request.on("timeout", () => {
        request.destroy(new Error("webhook timeout"));
        finish({ ok: false, httpStatus: null, errorCategory: "timeout" });
      });
      request.on("error", () =>
        finish({ ok: false, httpStatus: null, errorCategory: "network" }),
      );
      request.end(body);
    });
  } catch {
    return { ok: false, httpStatus: null, errorCategory: "unsafe_target" };
  }
}

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { OutboxEvent } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postWebhook } from "./webhook-http-client.js";
import { isPrivateAddress } from "./webhook-url-policy.js";

describe("webhook HTTP safety and outcomes", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/reset") {
        request.socket.destroy();
        return;
      }
      if (request.url === "/slow") {
        setTimeout(() => response.end(), 100);
        return;
      }
      response.statusCode = request.url === "/client" ? 400 : 500;
      response.end("ignored response body");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("listener failed");
    port = address.port;
  });

  afterAll(async () => new Promise((resolve) => server.close(resolve)));

  const event = {
    id: randomUUID(),
    tenantId: randomUUID(),
    applicationId: randomUUID(),
    environmentId: randomUUID(),
    eventType: "message.created",
    payload: {},
    deliveredAt: null,
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as OutboxEvent;

  it.each([
    ["client", "http_4xx", 400],
    ["server", "http_5xx", 500],
    ["reset", "network", null],
    ["slow", "timeout", null],
  ])("classifies %s failures safely", async (path, category, status) => {
    await expect(
      postWebhook({
        url: `http://127.0.0.1:${port}/${path}`,
        secret: "whsec_test",
        event,
        timeoutMs: 20,
        allowPrivateNetworks: true,
      }),
    ).resolves.toEqual({
      ok: false,
      httpStatus: status,
      errorCategory: category,
    });
  });

  it("recognizes private, link-local, loopback, and public addresses", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });
});

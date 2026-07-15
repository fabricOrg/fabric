import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Fabric,
  ResponseValidationError,
  type TimeoutError,
  UserAbortedError,
} from "./index.js";

type Mode = "success" | "retry" | "slow" | "malformed";

describe.sequential("real HTTP transport", () => {
  let mode: Mode;
  let attempts: number;
  let requests: IncomingMessage[];
  let baseUrl: string;
  const server = createServer((request, response) => {
    requests.push(request);
    attempts += 1;
    if (mode === "slow") {
      setTimeout(() => sendMessages(response), 200);
      return;
    }
    if (mode === "retry" && attempts === 1) {
      json(response, 503, {
        error: { code: "temporarily_unavailable", message: "Retry safely." },
        request_id: "req_retry_1",
      });
      return;
    }
    if (mode === "malformed") {
      json(response, 200, { messages: [{ id: "msg_missing_fields" }] });
      return;
    }
    if (request.url === "/v1/sms/messages") {
      void readBody(request).then((body) => {
        json(response, 201, {
          id: "msg_1",
          status: "accepted",
          encoding: "gsm7",
          segments: 1,
          cost: { minor: "5", currency: "GHS" },
          request_id: "req_send_1",
          received: body,
        });
      });
      return;
    }
    sendMessages(response);
  });

  beforeEach(async () => {
    mode = "success";
    attempts = 0;
    requests = [];
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  it("sends authentication, SDK identity, idempotency, and serialized input", async () => {
    const client = new Fabric({ apiKey: "sk_test_http", baseUrl });
    const result = await client.sms.send(
      { to: "+233545227189", senderId: "Fabric", body: "Hello" },
      { idempotencyKey: "order-123" },
    );
    const request = requests[0];
    expect(request?.headers.authorization).toBe("Bearer sk_test_http");
    expect(request?.headers["user-agent"]).toMatch(/^fabric-node\//);
    expect(request?.headers["idempotency-key"]).toBe("order-123");
    expect(result).toMatchObject({ requestId: "req_send_1", statusCode: 201 });
  });

  it("retries a transient read and preserves final metadata", async () => {
    mode = "retry";
    const result = await new Fabric({
      apiKey: "sk_test_http",
      baseUrl,
      maxRetries: 1,
    }).sms.list();
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ retryCount: 1, requestId: "req_list_1" });
  });

  it("turns an SDK deadline into a typed timeout", async () => {
    mode = "slow";
    const request = new Fabric({
      apiKey: "sk_test_http",
      baseUrl,
      maxRetries: 0,
    }).sms.list({ timeout: 10 });
    await expect(request).rejects.toMatchObject({
      code: "request_timeout",
      retryable: true,
    } satisfies Partial<TimeoutError>);
  });

  it("distinguishes caller cancellation from a timeout", async () => {
    mode = "slow";
    const controller = new AbortController();
    const request = new Fabric({
      apiKey: "sk_test_http",
      baseUrl,
      maxRetries: 0,
    }).sms.list({ signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toBeInstanceOf(UserAbortedError);
  });

  it("fails closed when a successful response violates the public contract", async () => {
    mode = "malformed";
    await expect(
      new Fabric({ apiKey: "sk_test_http", baseUrl }).sms.list(),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});

function sendMessages(response: ServerResponse): void {
  json(response, 200, { messages: [], request_id: "req_list_1" });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

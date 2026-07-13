import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Fabric, FabricError } from "@fabric-messaging/sdk";

const port = Number(process.env.PORT ?? 3400);
const index = await readFile(new URL("./index.html", import.meta.url), "utf8");

function actionsFor(fabric) {
  return {
    "sms.send": (p) =>
      fabric.sms.send(
        { to: p.to, senderId: p.senderId, body: p.body, class: p.class },
        { idempotencyKey: p.idempotencyKey },
      ),
    "sms.retrieve": (p) => fabric.sms.retrieve(p.id),
    "sms.list": () => fabric.sms.list(),
    "sms.sendBatch": (p) =>
      fabric.sms.sendBatch(p.items, { idempotencyKey: p.idempotencyKey }),
    "sms.retrieveBatch": (p) => fabric.sms.retrieveBatch(p.id),
    "email.send": (p) =>
      fabric.email.send(
        {
          to: p.to,
          from: p.from,
          subject: p.subject,
          text: p.text,
          html: p.html,
        },
        { idempotencyKey: p.idempotencyKey },
      ),
    "email.retrieve": (p) => fabric.email.retrieve(p.id),
    "email.list": () => fabric.email.list(),
    "verify.start": (p) =>
      fabric.verify.start({
        to: p.to,
        ...(p.senderId ? { senderId: p.senderId } : {}),
      }),
    "verify.check": (p) => fabric.verify.check({ id: p.id, code: p.code }),
    "wallet.retrieve": () => fabric.wallet.retrieve(),
    "senderIds.create": (p) =>
      fabric.senderIds.create({
        senderId: p.senderId,
        country: p.country,
        type: p.type,
        useCase: p.useCase,
      }),
    "senderIds.list": () => fabric.senderIds.list(),
    "webhooks.create": (p) =>
      fabric.webhooks.create({
        url: p.url,
        description: p.description,
        applicationId: p.applicationId,
        environment: p.environment,
      }),
    "webhooks.list": (p) => fabric.webhooks.list(p.applicationId),
    "webhooks.remove": (p) => fabric.webhooks.remove(p.id),
    "webhooks.verify": (p) =>
      fabric.webhooks.verify({
        payload: p.payload,
        signature: p.signature,
        secret: p.secret,
      }),
    "webhooks.signAndVerify": (p) => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = `t=${timestamp},v1=${createHmac("sha256", p.secret).update(`${timestamp}.${p.payload}`).digest("hex")}`;
      return {
        signature,
        event: fabric.webhooks.verify({
          payload: p.payload,
          signature,
          secret: p.secret,
        }),
      };
    },
    "virtualPhone.carrierReject": (p) =>
      fabric.sms.send(
        { to: "+233500000000", senderId: p.senderId, body: p.body },
        { idempotencyKey: p.idempotencyKey },
      ),
    "virtualPhone.platformFault": (p) =>
      fabric.sms.send(
        { to: "+233500000001", senderId: p.senderId, body: p.body },
        { idempotencyKey: p.idempotencyKey },
      ),
    "virtualPhone.delayedDlr": (p) =>
      fabric.sms.send(
        { to: "+233500000002", senderId: p.senderId, body: p.body },
        { idempotencyKey: p.idempotencyKey },
      ),
    "virtualPhone.autoStop": (p) =>
      fabric.sms.send(
        { to: "+233500000003", senderId: p.senderId, body: p.body },
        { idempotencyKey: p.idempotencyKey },
      ),
  };
}

const mutating = new Set([
  "sms.send",
  "sms.sendBatch",
  "email.send",
  "verify.start",
  "verify.check",
  "senderIds.create",
  "webhooks.create",
  "webhooks.remove",
  "virtualPhone.carrierReject",
  "virtualPhone.platformFault",
  "virtualPhone.delayedDlr",
  "virtualPhone.autoStop",
]);

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/")
    return send(response, 200, index, "text/html; charset=utf-8");
  if (request.method === "GET" && request.url === "/healthz")
    return json(response, 200, { status: "ok" });
  if (request.method !== "POST" || request.url !== "/api/run")
    return json(response, 404, { error: "Not found" });
  try {
    const body = JSON.parse(await readBody(request));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey)
      return json(response, 400, { error: "Enter a Fabric API key." });
    // baseUrl override: the request field wins, else FABRIC_BASE_URL, else the SDK default. Lets you
    // point the playground at a local API (http://localhost:3000). The SDK only permits https or a
    // loopback host, so an invalid override throws below and surfaces as a 400.
    const baseUrl =
      (typeof body.baseUrl === "string" && body.baseUrl.trim()) ||
      process.env.FABRIC_BASE_URL ||
      "";
    const fabric = new Fabric({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    const actions = actionsFor(fabric);
    const action = typeof body.action === "string" ? body.action : "";
    const handler = actions[action];
    if (!handler) return json(response, 400, { error: "Unknown SDK action." });
    if (
      fabric.environment === "production" &&
      mutating.has(action) &&
      process.env.FABRIC_ALLOW_LIVE_WRITES !== "true"
    ) {
      return json(response, 403, {
        error:
          "Live-key mutations are disabled. Use a sandbox key or explicitly enable live writes.",
      });
    }
    const result = await handler(body.params ?? {});
    return json(response, 200, { environment: fabric.environment, result });
  } catch (error) {
    const status = error instanceof FabricError ? (error.status ?? 400) : 400;
    return json(response, status, {
      error: error instanceof Error ? error.message : "Unknown error",
      ...(error instanceof FabricError
        ? { code: error.code, requestId: error.requestId }
        : {}),
    });
  }
}).listen(port, "0.0.0.0", () =>
  console.log(`Fabric SDK Playground listening on port ${port}`),
);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString("utf8");
  if (value.length > 100_000) throw new Error("Request is too large.");
  return value;
}
function json(response, status, value) {
  return send(
    response,
    status,
    JSON.stringify(value, null, 2),
    "application/json",
  );
}
function send(response, status, value, type) {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(value);
}

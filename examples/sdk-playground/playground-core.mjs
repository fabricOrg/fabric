import { createHmac } from "node:crypto";
import { Fabric, FabricError } from "@fabric-messaging/sdk";

/** Shared between the local Node server (server.mjs) and the Vercel function (api/run.mjs). */
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

export async function runAction(body) {
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey)
    return { status: 400, payload: { error: "Enter a Fabric API key." } };
  // baseUrl override: the request field wins, else FABRIC_BASE_URL, else the SDK default.
  const baseUrl =
    (typeof body.baseUrl === "string" && body.baseUrl.trim()) ||
    process.env.FABRIC_BASE_URL ||
    "";
  try {
    const fabric = new Fabric({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    const actions = actionsFor(fabric);
    const action = typeof body.action === "string" ? body.action : "";
    const handler = actions[action];
    if (!handler)
      return { status: 400, payload: { error: "Unknown SDK action." } };
    if (
      fabric.environment === "production" &&
      mutating.has(action) &&
      process.env.FABRIC_ALLOW_LIVE_WRITES !== "true"
    ) {
      return {
        status: 403,
        payload: {
          error:
            "Live-key mutations are disabled. Use a sandbox key or explicitly enable live writes.",
        },
      };
    }
    const result = await handler(body.params ?? {});
    return {
      status: 200,
      payload: { environment: fabric.environment, result },
    };
  } catch (error) {
    const status = error instanceof FabricError ? (error.status ?? 400) : 400;
    return {
      status,
      payload: {
        error: error instanceof Error ? error.message : "Unknown error",
        ...(error instanceof FabricError
          ? { code: error.code, requestId: error.requestId }
          : {}),
      },
    };
  }
}

export const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

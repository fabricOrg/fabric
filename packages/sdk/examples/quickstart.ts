import { Fabric } from "@fabric-messaging/sdk";

const apiKey = process.env.FABRIC_API_KEY;
if (!apiKey) throw new Error("Set FABRIC_API_KEY before running this example.");

const fabric = new Fabric({ apiKey });
const result = await fabric.sms.send(
  {
    to: "+233545227189",
    senderId: "SANDBOX",
    body: "Your first Fabric message",
  },
  { idempotencyKey: "quickstart-first-message" },
);

console.log({
  id: result.data.id,
  status: result.data.status,
  requestId: result.requestId,
});

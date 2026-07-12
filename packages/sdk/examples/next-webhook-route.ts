import { Fabric } from "fabric-messaging";

const fabric = new Fabric({
  apiKey: process.env.FABRIC_API_KEY ?? "sk_test_example",
});

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.FABRIC_WEBHOOK_SECRET;
  if (!secret)
    return new Response("Webhook secret is not configured.", { status: 503 });
  const event = fabric.webhooks.verify({
    payload: await request.text(),
    signature: request.headers.get("fabric-signature") ?? undefined,
    secret,
  });
  console.log({ eventId: event.id, eventType: event.type });
  return new Response(null, { status: 202 });
}

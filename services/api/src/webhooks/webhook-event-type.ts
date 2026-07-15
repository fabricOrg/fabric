/** Internal transition names stay private; public consumers receive the stable direct vocabulary. */
export function publicWebhookEventType(
  eventType: string,
  payload: unknown,
): string {
  if (eventType === "message.created") return "message.sent";
  if (eventType === "message.received") return "message.inbound";
  if (eventType !== "message.updated") return eventType;

  const status =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).status
      : undefined;
  if (status === "delivered") return "message.delivered";
  if (status === "undelivered") return "message.undelivered";
  if (status === "failed" || status === "expired") return "message.failed";
  return "message.sent";
}

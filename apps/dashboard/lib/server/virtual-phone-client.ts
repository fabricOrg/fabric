import "server-only";

import {
  type DeliveryMode,
  type MessagingSettings,
  messagingSettings,
  type VirtualPhoneInbox,
  virtualPhoneInbox,
} from "@app/contracts";
import { BffError } from "./api-client";

function backend() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken)
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  return { baseUrl, bffToken };
}

async function request(
  tenantId: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const { baseUrl, bffToken } = backend();
  const response = await fetch(
    new URL(`/internal/tenants/${tenantId}${path}`, baseUrl),
    {
      ...init,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-bff-token": bffToken,
        ...init?.headers,
      },
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new BffError(response.status, payload);
  return payload;
}

export async function getMessagingSettings(
  tenantId: string,
): Promise<MessagingSettings> {
  return messagingSettings.parse(
    await request(tenantId, "/messaging-settings"),
  );
}

export async function setMessagingMode(
  tenantId: string,
  deliveryMode: DeliveryMode,
  actorEmail?: string,
): Promise<MessagingSettings> {
  return messagingSettings.parse(
    await request(tenantId, "/messaging-settings", {
      method: "PATCH",
      headers: actorEmail ? { "x-actor-email": actorEmail } : undefined,
      body: JSON.stringify({ delivery_mode: deliveryMode }),
    }),
  );
}

export async function getVirtualPhoneInbox(
  tenantId: string,
): Promise<VirtualPhoneInbox> {
  return virtualPhoneInbox.parse(
    await request(tenantId, "/virtual-phone/messages"),
  );
}

export async function readVirtualMessage(
  tenantId: string,
  messageId: string,
): Promise<void> {
  await request(
    tenantId,
    `/virtual-phone/messages/${encodeURIComponent(messageId)}/read`,
    { method: "PATCH", body: "{}" },
  );
}

import {
  messageDetailResponse,
  messagingSettings,
  type SendSmsRequest,
  sendSmsApiResponse,
  virtualPhoneInbox,
  virtualPhoneReplyResponse,
  walletSnapshot,
} from "@app/contracts";

async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function getWallet() {
  const snapshot = walletSnapshot.parse(
    await bffRequest("/api/dashboard/wallet"),
  );
  return snapshot.balances;
}

export async function getMessage(id: string) {
  const response = messageDetailResponse.parse(
    await bffRequest(`/api/dashboard/messages/${encodeURIComponent(id)}`),
  );
  return response.message;
}

export async function sendSms(input: SendSmsRequest) {
  return sendSmsApiResponse.parse(
    await bffRequest("/api/dashboard/sms/send", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function getMessagingSettings() {
  return messagingSettings.parse(
    await bffRequest("/api/dashboard/messaging-settings"),
  );
}

export async function updateMessagingMode(delivery_mode: "virtual" | "live") {
  return messagingSettings.parse(
    await bffRequest("/api/dashboard/messaging-settings", {
      method: "PATCH",
      body: JSON.stringify({ delivery_mode }),
    }),
  );
}

export async function getVirtualPhone(cursor?: string, recipient?: string) {
  const search = new URLSearchParams();
  if (cursor) search.set("cursor", cursor);
  if (recipient) search.set("recipient", recipient);
  return virtualPhoneInbox.parse(
    await bffRequest(
      `/api/dashboard/virtual-phone${search.size > 0 ? `?${search}` : ""}`,
    ),
  );
}

export async function markVirtualMessageRead(messageId: string) {
  await bffRequest(
    `/api/dashboard/virtual-phone/${encodeURIComponent(messageId)}/read`,
    { method: "PATCH", body: "{}" },
  );
}

export async function sendVirtualReply(input: { to: string; body: string }) {
  return virtualPhoneReplyResponse.parse(
    await bffRequest("/api/dashboard/virtual-phone", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function clearVirtualPhone() {
  return bffRequest("/api/dashboard/virtual-phone", { method: "DELETE" });
}

export async function simulateDeliveredDlr(messageId: string) {
  await bffRequest("/api/dashboard/sms/fake-dlr", {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
}

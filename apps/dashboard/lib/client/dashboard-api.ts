import {
  messageDetailResponse,
  type SendSmsRequest,
  sendSmsApiResponse,
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

export async function simulateDeliveredDlr(messageId: string) {
  await bffRequest("/api/dashboard/sms/fake-dlr", {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
}

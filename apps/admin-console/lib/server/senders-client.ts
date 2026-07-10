import "server-only";

import {
  type AdminSenderDto,
  adminSenderDtoSchema,
  type DecideSenderRequest,
  type ListAdminSendersResponse,
  listAdminSendersResponseSchema,
  type SenderDto,
  senderDtoSchema,
} from "@app/contracts";

/** Sender-ID review queue via the api's BffToken-guarded /internal/admin/senders (E10). */
export class SenderApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Senders API request failed with status ${status}.`);
  }
}

function config() {
  const baseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!baseUrl || !bffToken) {
    throw new Error("API_BASE_URL and BFF_INTERNAL_TOKEN are required.");
  }
  return { baseUrl, bffToken };
}

export async function listSenderQueue(): Promise<ListAdminSendersResponse> {
  const { baseUrl, bffToken } = config();
  const response = await fetch(new URL("/internal/admin/senders", baseUrl), {
    cache: "no-store",
    headers: { "x-bff-token": bffToken },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new SenderApiError(response.status, payload);
  return listAdminSendersResponseSchema.parse(payload);
}

export async function decideSender(
  id: string,
  request: DecideSenderRequest,
  actor: { email: string; staffId: string },
): Promise<SenderDto> {
  const { baseUrl, bffToken } = config();
  const response = await fetch(
    new URL(`/internal/admin/senders/${id}/decide`, baseUrl),
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "x-bff-token": bffToken,
        "content-type": "application/json",
        "x-actor-email": actor.email,
        "x-actor-staff-id": actor.staffId,
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw new SenderApiError(response.status, payload);
  return senderDtoSchema.parse(payload);
}

export type { AdminSenderDto };
export { adminSenderDtoSchema };

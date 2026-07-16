import "server-only";

import {
  type CreateMessageDefinitionRequest,
  type ListMessageDefinitionsResponse,
  listMessageDefinitionsResponse,
  type MessageDefinitionState,
  messageDefinitionState,
  type PreviewMessageRequest,
  type PreviewMessageResponse,
  type PublishMessageDefinitionRequest,
  previewMessageResponse,
} from "@app/contracts";
import { dashboardApi } from "./api-client";

/**
 * Managed message definitions (SDK-003) via the data-plane `/v1/message-definitions` +
 * `/v1/messages/preview`. dashboardApi mints a short-lived tenant token from the authenticated
 * session (ADR-0003); the API derives the tenant from that token, never the client. Reads use the
 * universal `applications:read` permission; the write role gate (owner/admin) lives in the BFF route
 * handlers. Responses are parsed against the shared contract at the boundary.
 */
export async function listMessageDefinitions(): Promise<ListMessageDefinitionsResponse> {
  const payload = await dashboardApi<unknown>(
    "/v1/message-definitions",
    "applications:read",
  );
  return listMessageDefinitionsResponse.parse(payload);
}

export async function createMessageDefinition(
  request: CreateMessageDefinitionRequest,
): Promise<MessageDefinitionState> {
  const payload = await dashboardApi<unknown>(
    "/v1/message-definitions",
    "applications:read",
    { method: "POST", body: JSON.stringify(request) },
  );
  return messageDefinitionState.parse(payload);
}

export async function publishMessageDefinition(
  id: string,
  request: PublishMessageDefinitionRequest,
): Promise<MessageDefinitionState> {
  const payload = await dashboardApi<unknown>(
    `/v1/message-definitions/${id}/publish`,
    "applications:read",
    { method: "POST", body: JSON.stringify(request) },
  );
  return messageDefinitionState.parse(payload);
}

export async function archiveMessageDefinition(id: string): Promise<void> {
  await dashboardApi<unknown>(
    `/v1/message-definitions/${id}/archive`,
    "applications:read",
    { method: "POST", body: "{}" },
  );
}

export async function previewMessage(
  request: PreviewMessageRequest,
): Promise<PreviewMessageResponse> {
  const payload = await dashboardApi<unknown>(
    "/v1/messages/preview",
    "applications:read",
    { method: "POST", body: JSON.stringify(request) },
  );
  return previewMessageResponse.parse(payload);
}

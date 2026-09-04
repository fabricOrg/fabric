import {
  parseMessageDeliverySummary,
  parseMessageDeliveryWebhookStatus,
} from "./message-delivery.js";
import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  ListParams,
  MessageDeliverySummary,
  MessageDeliveryWebhookStatus,
  Page,
  RequestOptions,
} from "./types.js";
import {
  ApiShapeError,
  nullableStringField,
  pageQueryString,
  record,
  requireNonEmpty,
} from "./validation.js";

export async function listMessageDeliveries(
  transport: Transport,
  params?: ListParams,
  options?: RequestOptions,
): Promise<FabricResponse<Page<MessageDeliverySummary>>> {
  const response = await transport.request<Record<string, unknown>>({
    method: "GET",
    path: `/v1/message-deliveries${pageQueryString(params)}`,
    ...(options ? { options } : {}),
  });
  if (!Array.isArray(response.data.deliveries))
    throw new ApiShapeError("deliveries");
  return {
    ...response,
    data: {
      items: response.data.deliveries.map((value) =>
        parseMessageDeliverySummary(record(value)),
      ),
      nextCursor: nullableStringField(response.data.next_cursor, "next_cursor"),
    },
  };
}

export async function* iterateMessageDeliveries(
  transport: Transport,
  params?: Pick<ListParams, "limit">,
  options?: RequestOptions,
): AsyncGenerator<MessageDeliverySummary, void, undefined> {
  let cursor: string | undefined;
  do {
    const page = await listMessageDeliveries(
      transport,
      {
        ...(params?.limit ? { limit: params.limit } : {}),
        ...(cursor ? { cursor } : {}),
      },
      options,
    );
    yield* page.data.items;
    const next = page.data.nextCursor ?? undefined;
    cursor = next === cursor ? undefined : next;
  } while (cursor);
}

export async function listMessageDeliveryWebhooks(
  transport: Transport,
  id: string,
  options?: RequestOptions,
): Promise<FabricResponse<ReadonlyArray<MessageDeliveryWebhookStatus>>> {
  requireNonEmpty(id, "id");
  const response = await transport.request<Record<string, unknown>>({
    method: "GET",
    path: `/v1/message-deliveries/${encodeURIComponent(id)}/webhooks`,
    ...(options ? { options } : {}),
  });
  if (!Array.isArray(response.data.webhooks))
    throw new ApiShapeError("webhooks");
  return {
    ...response,
    data: response.data.webhooks.map((value) =>
      parseMessageDeliveryWebhookStatus(record(value)),
    ),
  };
}

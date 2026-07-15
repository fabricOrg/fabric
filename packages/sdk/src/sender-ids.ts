import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  RequestOptions,
  SenderId,
  WriteOptions,
} from "./types.js";
import {
  enumField,
  record,
  requireNonEmpty,
  stringField,
} from "./validation.js";

export interface CreateSenderIdParams {
  readonly senderId: string;
  readonly country: "GH" | "NG";
  readonly type?: "alphanumeric" | "short-code";
  readonly useCase: string;
}

export class SenderIdsResource {
  constructor(private readonly transport: Transport) {}

  async create(
    params: CreateSenderIdParams,
    options?: WriteOptions,
  ): Promise<FabricResponse<SenderId>> {
    requireNonEmpty(params.senderId, "senderId");
    requireNonEmpty(params.useCase, "useCase");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/senders",
      body: {
        sender_id: params.senderId,
        country: params.country,
        type: params.type ?? "alphanumeric",
        use_case: params.useCase,
      },
      ...(options ? { options } : {}),
    });
    return { ...response, data: parseSender(response.data) };
  }

  async list(
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<SenderId>>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/senders",
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.senders))
      throw new TypeError("Fabric returned an invalid sender ID list.");
    return {
      ...response,
      data: response.data.senders.map((item) => parseSender(record(item))),
    };
  }
}

function parseSender(data: Record<string, unknown>): SenderId {
  return {
    id: stringField(data.id, "id"),
    senderId: stringField(data.sender_id, "sender_id"),
    country: enumField(data.country, ["GH", "NG"] as const, "country"),
    type: enumField(data.type, ["alphanumeric", "short-code"] as const, "type"),
    useCase: stringField(data.use_case, "use_case"),
    status: enumField(
      data.status,
      ["pending", "active", "rejected"] as const,
      "status",
    ),
    rejectionReason:
      data.rejection_reason === null
        ? null
        : stringField(data.rejection_reason, "rejection_reason"),
    createdAt: stringField(data.created_at, "created_at"),
  };
}

import type { MessageDetail, SendSmsResponse } from "@app/contracts";

interface MessageReader {
  get(tenantId: string, id: string): Promise<MessageDetail>;
}

export async function replayManagedSend(
  reader: MessageReader,
  tenantId: string,
  messageId: string,
): Promise<SendSmsResponse> {
  const message = await reader.get(tenantId, messageId);
  return {
    id: message.id,
    status: message.status,
    encoding: message.encoding,
    segments: message.segments,
    cost: message.cost,
  };
}

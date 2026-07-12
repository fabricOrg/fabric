import type { VirtualPhoneMessage } from "@app/contracts";

export interface VirtualThread {
  key: string;
  to: string;
  from: string;
  messages: VirtualPhoneMessage[];
  lastMessage: VirtualPhoneMessage;
  unread: number;
}

export function groupVirtualThreads(
  messages: VirtualPhoneMessage[],
): VirtualThread[] {
  const groups = new Map<string, VirtualPhoneMessage[]>();
  for (const message of messages) {
    const key = `${message.to}\u0000${message.from}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => {
      const sorted = [...grouped].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      return {
        key,
        to: sorted[0]?.to ?? "",
        from: sorted[0]?.from ?? "",
        messages: sorted,
        lastMessage: sorted[sorted.length - 1] as VirtualPhoneMessage,
        unread: sorted.filter((message) => message.read_at === null).length,
      };
    })
    .sort((a, b) =>
      b.lastMessage.created_at.localeCompare(a.lastMessage.created_at),
    );
}

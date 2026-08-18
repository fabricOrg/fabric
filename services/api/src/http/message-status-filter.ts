import { type MessageStatusGroup, messageStatusGroup } from "@app/contracts";
import { invalidRequest } from "./api-error.js";

export function parseMessageStatusGroup(
  value: unknown,
): MessageStatusGroup | undefined {
  if (value === undefined) return undefined;
  const parsed = messageStatusGroup.safeParse(value);
  if (parsed.success) return parsed.data;
  throw invalidRequest(
    "invalid_status",
    "status must be active, delivered, or failed.",
    "status",
  );
}

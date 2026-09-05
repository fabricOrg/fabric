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
    // Derived, not restated: the literal list went stale the moment `unknown` was added, and a
    // caller was told a valid value was invalid.
    `status must be one of: ${messageStatusGroup.options.join(", ")}.`,
    "status",
  );
}

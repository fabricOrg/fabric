import type { DeliveryMode } from "@app/contracts";
import type { ConfigService } from "@nestjs/config";
import { invalidRequest } from "../http/api-error.js";
import { isLiveRecipientAllowed } from "./sms-providers.js";

/** Carrier delivery is a human-gated drill until the production launch is explicitly approved. */
export function assertLiveRecipientAllowed(
  config: ConfigService,
  deliveryMode: DeliveryMode,
  recipient: string,
): void {
  if (deliveryMode !== "live" || isLiveRecipientAllowed(config, recipient)) {
    return;
  }
  throw invalidRequest(
    "live_recipient_not_allowed",
    "Carrier delivery is not enabled for this recipient.",
    "to",
  );
}

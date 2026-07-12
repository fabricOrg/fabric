import type { SendInput, SendResult } from "@app/sms-engine";
import type { VirtualPhoneService } from "./virtual-phone.service.js";

export async function maybeAutoStop(
  virtualPhone: VirtualPhoneService,
  input: SendInput,
  result: SendResult,
): Promise<void> {
  if (!input.to.endsWith("0003") || result.status !== "delivered") return;
  await virtualPhone.reply(input.tenantId, { to: input.to, body: "STOP" });
}

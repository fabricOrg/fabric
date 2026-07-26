import {
  failPreparedSend as engineFailPreparedSend,
  type PreparedSend,
  type SendInput,
} from "@app/sms-engine";
import type { VirtualPhoneService } from "./virtual-phone.service.js";

/**
 * Persist the virtual delivery for a prepared send; on failure, release the reservation
 * (failPreparedSend) and rethrow so the request surfaces the error rather than leaving a reserved,
 * undeliverable message. Extracted from SmsService.send to keep the service under the file-length guard.
 */
export async function recordVirtualDeliveryOrFail(params: {
  virtualPhone: VirtualPhoneService;
  deps: Parameters<typeof engineFailPreparedSend>[0];
  tenantId: string;
  body: string;
  subjectId: string;
  bodyPiiId: string;
  prepared: PreparedSend;
  routedInput: SendInput;
}): Promise<void> {
  try {
    await params.virtualPhone.record({
      tenantId: params.tenantId,
      messageId: params.prepared.messageId,
      subjectId: params.subjectId,
      body: params.body,
      bodyPiiId: params.bodyPiiId,
    });
  } catch (error) {
    await engineFailPreparedSend(
      params.deps,
      params.routedInput,
      params.prepared,
      "virtual_delivery_persistence_failed",
    );
    throw error;
  }
}

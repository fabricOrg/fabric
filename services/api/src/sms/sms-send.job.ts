import type { DeliveryMode } from "@app/contracts";
import type { PreparedSend, SendInput } from "@app/sms-engine";

/**
 * The sms-send job payload: everything dispatch needs (tx1 already ran). Carries transient PII by
 * design — jobs are trimmed on completion; Redis is transport, never storage.
 *
 * Lives apart from SmsService because it is the contract BETWEEN the producer (send) and the
 * consumer (the worker) — both import it, neither owns it.
 */
export interface DurableSmsSendJob {
  tenantId: string;
  messageId: string;
  deliveryMode: DeliveryMode;
}

/** Compatibility shape for jobs created before durable dispatch intents shipped. */
export interface LegacySmsSendJob {
  input: SendInput;
  prepared: PreparedSend;
  deliveryMode?: DeliveryMode;
  /** Pre-F3 jobs only: legacy sandbox flag, kept so in-flight jobs still route correctly. */
  sandbox?: boolean;
}

export type SmsSendJob = DurableSmsSendJob | LegacySmsSendJob;

export const SMS_SEND_QUEUE = "sms-send";

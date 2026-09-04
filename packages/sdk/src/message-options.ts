import type { IdempotentWriteOptions, RequestOptions } from "./types.js";

export interface PreviewMessageOptions extends RequestOptions {
  /** Variables for the definition's schema; validated server-side without side effects. */
  readonly data?: Record<string, unknown>;
  /** Pricing currency (ISO-4217). Defaults to the workspace currency server-side. */
  readonly currency?: string;
  /** Optional E.164 recipient for sender, consent, and quiet-hour eligibility checks. */
  readonly to?: string;
  /** Optional released locale; the definition's default is used when omitted. */
  readonly locale?: string;
  /** Optional assertion of the released definition channel. */
  readonly channel?: "sms" | "email" | "whatsapp";
}

export interface SendMessageOptions extends IdempotentWriteOptions {
  /** Recipient: E.164 for SMS/WhatsApp, or an email address for Email. */
  readonly to: string;
  readonly data?: Record<string, unknown>;
  readonly locale?: string;
  /** Optional assertion of the released definition channel. */
  readonly channel?: "sms" | "email" | "whatsapp";
  readonly currency?: string;
  /** Caller correlation id surfaced on the delivery. */
  readonly reference?: string;
  /** Flat key/value annotations stored on the delivery (max 4KB serialized). */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Fail closed before send or charge when rendered cost exceeds this amount. */
  readonly maxCost?: { readonly minor: string; readonly currency: string };
}

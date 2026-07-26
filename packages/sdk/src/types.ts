export type FabricEnvironment = "sandbox" | "live";

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Options for direct writes where idempotency remains optional for beta compatibility. */
export interface WriteOptions extends RequestOptions {
  readonly idempotencyKey?: string;
}

/** Options for operations that cannot execute safely without durable caller idempotency. */
export interface IdempotentWriteOptions extends RequestOptions {
  readonly idempotencyKey: string;
}

export interface FabricResponse<T> {
  readonly data: T;
  readonly requestId?: string;
  readonly retryCount: number;
  readonly statusCode: number;
}

/** Cursor-pagination input for list calls. Limit defaults to 50 server-side (max 100). */
export interface ListParams {
  readonly limit?: number;
  readonly cursor?: string;
}

/** One page of a cursor-paginated list; `nextCursor` is null on the final page. */
export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

export interface Money {
  readonly minor: string;
  readonly currency: "GHS" | "NGN" | "USD";
}

export type MessageStatus =
  | "accepted"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "expired";

export interface SendSmsParams {
  readonly to: string;
  readonly senderId: string;
  readonly body: string;
  readonly currency?: string;
  readonly class?: "transactional" | "promotional";
}

export interface SentSms {
  readonly id: string;
  readonly status: MessageStatus;
  readonly encoding: "gsm7" | "ucs2";
  readonly segments: number;
  readonly cost: Money;
}

export interface SendSmsBatchItem extends SendSmsParams {
  readonly clientReference: string;
}

export interface SmsBatchItemResult {
  readonly clientReference: string;
  readonly messageId: string | null;
  readonly status: MessageStatus | "failed";
  readonly errorCode: string | null;
}

export interface SmsBatch {
  readonly id: string;
  readonly status: "processing" | "completed";
  readonly totalCount: number;
  readonly acceptedCount: number;
  readonly failedCount: number;
  readonly items: ReadonlyArray<SmsBatchItemResult>;
}

export interface MessageSummary extends SentSms {
  readonly to: string;
  readonly provider: string;
  readonly deliveryMode: "live" | "virtual";
  readonly createdAt: string;
}

export interface MessageDetail extends MessageSummary {
  readonly senderId: string;
  readonly body?: string;
  readonly redacted: boolean;
  readonly timeline: ReadonlyArray<{
    readonly status: MessageStatus;
    readonly at: string;
    readonly note?: string;
  }>;
  readonly failureReason?: string;
}

export interface SendEmailParams {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
}

export interface EmailMessage {
  readonly id: string;
  readonly status: MessageStatus;
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly provider: string;
  readonly createdAt: string;
  readonly errorCode: string | null;
}

export interface SenderId {
  readonly id: string;
  readonly senderId: string;
  readonly country: "GH" | "NG";
  readonly type: "alphanumeric" | "short-code";
  readonly useCase: string;
  readonly status: "pending" | "active" | "rejected";
  readonly rejectionReason: string | null;
  readonly createdAt: string;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly status: "active" | "disabled";
  readonly description: string | null;
  readonly environment: "sandbox" | "live";
  readonly secretPrefix: string;
  readonly createdAt: string;
  readonly health: {
    readonly pending: number;
    readonly dead: number;
    readonly lastDeliveredAt: string | null;
  };
}

export interface WebhookDelivery {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly state: "pending" | "delivering" | "delivered" | "dead";
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly lastErrorCategory: string | null;
  readonly lastHttpStatus: number | null;
  readonly createdAt: string;
}

/** Lifecycle of a managed delivery — mirrors the message pipeline, minus pre-dispatch queue states. */
export type MessageDeliveryStatus =
  | "accepted"
  | "processing"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "expired";

/** One provider attempt inside a managed delivery (ordinal 1 = the original send). */
export interface MessageDeliveryAttempt {
  readonly id: string;
  readonly ordinal: number;
  readonly channel: "sms" | "email";
  readonly messageId: string | null;
  readonly status: MessageDeliveryStatus;
  readonly cost: Money;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A managed send addressed by a definition's stable key. The id is deterministic per
 * tenant/application/environment/idempotency-key, so a replayed request returns this same resource.
 */
export interface MessageDelivery {
  readonly id: string;
  readonly key: string;
  readonly versionId: string;
  readonly environment: FabricEnvironment;
  readonly locale: string;
  readonly channel: "sms" | "email";
  readonly status: MessageDeliveryStatus;
  readonly resourceVersion: number;
  readonly recipient: string;
  readonly reference: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly cost: Money;
  readonly attempts: ReadonlyArray<MessageDeliveryAttempt>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A field-path error that blocks a preview. Carries a path + stable code, never the rejected value. */
export interface PreviewBlocker {
  readonly path: string;
  readonly code: string;
}

/** The rendered SMS a preview produced (present only for an SMS channel with no blockers). */
export interface SmsPreview {
  readonly body: string;
  readonly encoding: "gsm7" | "ucs2";
  readonly length: number;
  readonly segments: number;
  readonly costMinor: string;
  readonly currency: string;
}

/** The rendered email a preview produced (present only for an Email channel with no blockers). */
export interface EmailPreview {
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  /** Rendered UTF-8 byte size (measured to enforce the 256 KiB ceiling; email is priced flat per send). */
  readonly sizeBytes: number;
  readonly costMinor: string;
  readonly currency: string;
}

/**
 * Result of previewing a released definition — equals what a subsequent send would render. `channel`
 * discriminates the rendered result: `preview` is set for SMS, `emailPreview` for Email; the other is
 * null. An SMS consumer written before Email shipped reads `preview` and is unaffected.
 */
export interface MessagePreview {
  readonly versionId: string;
  readonly channel: "sms" | "email";
  readonly environment: "sandbox" | "live";
  readonly resolvedLocale: string;
  readonly blockers: readonly PreviewBlocker[];
  readonly warnings: readonly PreviewBlocker[];
  readonly eligible: boolean;
  readonly sender: {
    readonly senderId: string;
    readonly status:
      | "sandbox"
      | "active"
      | "pending"
      | "rejected"
      | "unregistered"
      | "not_evaluated";
  };
  readonly messageClass: "transactional" | "promotional";
  readonly preview: SmsPreview | null;
  readonly emailPreview: EmailPreview | null;
}

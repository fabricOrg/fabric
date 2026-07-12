export type FabricEnvironment = "sandbox" | "production";

export interface RequestOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface FabricResponse<T> {
  readonly data: T;
  readonly requestId?: string;
  readonly retryCount: number;
  readonly statusCode: number;
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
}

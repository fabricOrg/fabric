import { EmailResource } from "./email.js";
import { MessagesResource } from "./messages.js";
import { SenderIdsResource } from "./sender-ids.js";
import { SmsResource } from "./sms.js";
import { type FabricLogger, Transport } from "./transport.js";
import type { FabricEnvironment } from "./types.js";
import { VerifyResource } from "./verify.js";
import { WalletResource } from "./wallet.js";
import { WebhooksResource } from "./webhooks.js";

const VERSION = "0.1.0-beta.5";
// The SDK owns endpoint selection. Consumers only provide a key; `baseUrl` is reserved for
// loopback development and private test deployments.
const DEFAULT_BASE_URL = "https://d2umm5b2x22zvp.cloudfront.net";

export interface FabricConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: FabricLogger;
}

export class Fabric {
  readonly environment: FabricEnvironment;
  readonly sms: SmsResource;
  readonly email: EmailResource;
  readonly senderIds: SenderIdsResource;
  readonly verify: VerifyResource;
  readonly wallet: WalletResource;
  readonly webhooks: WebhooksResource;
  readonly messages: MessagesResource;

  constructor(config: FabricConfig) {
    assertServerRuntime();
    this.environment = environmentForKey(config.apiKey);
    if (
      !Number.isInteger(config.maxRetries ?? 2) ||
      (config.maxRetries ?? 2) < 0
    ) {
      throw new TypeError("`maxRetries` must be a non-negative integer.");
    }
    if (
      !Number.isFinite(config.timeout ?? 10_000) ||
      (config.timeout ?? 10_000) <= 0
    ) {
      throw new TypeError(
        "`timeout` must be a positive number of milliseconds.",
      );
    }
    const transport = new Transport({
      apiKey: config.apiKey,
      baseUrl: normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL),
      timeout: config.timeout ?? 10_000,
      maxRetries: config.maxRetries ?? 2,
      fetch: config.fetch ?? globalThis.fetch,
      sdkVersion: VERSION,
      ...(config.logger ? { logger: config.logger } : {}),
    });
    this.sms = new SmsResource(transport);
    this.email = new EmailResource(transport);
    this.senderIds = new SenderIdsResource(transport);
    this.verify = new VerifyResource(transport);
    this.wallet = new WalletResource(transport);
    this.webhooks = new WebhooksResource(transport);
    this.messages = new MessagesResource(transport);
  }
}

export { Fabric as MessagingClient };

function environmentForKey(apiKey: string): FabricEnvironment {
  if (apiKey.startsWith("sk_test_")) return "sandbox";
  if (apiKey.startsWith("sk_live_")) return "live";
  throw new TypeError(
    "`apiKey` must be a Fabric secret key beginning with `sk_test_` or `sk_live_`.",
  );
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLoopback(url)) {
    throw new TypeError(
      "`baseUrl` must use HTTPS except for loopback development servers.",
    );
  }
  return url.toString();
}

function isLoopback(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined" && typeof window.document !== "undefined") {
    throw new TypeError(
      "@fabric-messaging/sdk contains secret API keys and can only run in a trusted server environment.",
    );
  }
}

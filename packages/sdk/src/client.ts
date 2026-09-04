import packageJson from "../package.json" with { type: "json" };
import type { DefinitionCatalog, UngeneratedCatalog } from "./catalog.js";
import { EmailResource } from "./email.js";
import { MessagesResource } from "./messages.js";
import { SenderIdsResource } from "./sender-ids.js";
import { SmsResource } from "./sms.js";
import { type FabricLogger, Transport } from "./transport.js";
import type { FabricEnvironment } from "./types.js";
import { VerifyResource } from "./verify.js";
import { WalletResource } from "./wallet.js";
import { WebhooksResource } from "./webhooks.js";
import { WhatsAppResource } from "./whatsapp.js";

const VERSION = packageJson.version;
/**
 * The SDK owns endpoint selection: a consumer provides a key and nothing else, and the key prefix
 * already decides test vs live. There is deliberately no `baseUrl` on `FabricConfig` — publishing a
 * knob we tell people not to turn invited exactly the confusion it caused.
 *
 * The escape hatch for loopback development and private deployments is `FABRIC_BASE_URL`, which is
 * the variable the CLI has always read (`packages/cli/src/bin.ts`). It is validated the same way a
 * caller-supplied value was: HTTPS unless loopback, no credentials, no query or fragment.
 */
const DEFAULT_BASE_URL = "https://fabric-jezz.onrender.com";

function resolveBaseUrl(): string {
  const configured = globalThis.process?.env?.FABRIC_BASE_URL?.trim();
  return normalizeBaseUrl(configured ? configured : DEFAULT_BASE_URL);
}

export interface FabricConfig {
  readonly apiKey: string;
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: FabricLogger;
}

export class Fabric<Catalog extends DefinitionCatalog = UngeneratedCatalog> {
  readonly environment: FabricEnvironment;
  readonly sms: SmsResource;
  readonly email: EmailResource;
  readonly senderIds: SenderIdsResource;
  readonly verify: VerifyResource;
  readonly wallet: WalletResource;
  readonly webhooks: WebhooksResource;
  readonly messages: MessagesResource<Catalog>;
  readonly whatsapp: WhatsAppResource;

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
      baseUrl: resolveBaseUrl(),
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
    this.messages = new MessagesResource<Catalog>(transport);
    this.whatsapp = new WhatsAppResource(transport);
  }
}

export { Fabric as MessagingClient };

function environmentForKey(apiKey: string): FabricEnvironment {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new TypeError("`apiKey` must be a non-empty Fabric secret key.");
  }
  if (apiKey.startsWith("sk_test_") && apiKey.length > "sk_test_".length)
    return "sandbox";
  if (apiKey.startsWith("sk_live_") && apiKey.length > "sk_live_".length)
    return "live";
  throw new TypeError(
    "`apiKey` must be a Fabric secret key beginning with `sk_test_` or `sk_live_`.",
  );
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("`FABRIC_BASE_URL` must be an absolute URL.");
  }
  if (url.username || url.password) {
    throw new TypeError(
      "`FABRIC_BASE_URL` must not contain embedded credentials.",
    );
  }
  if (url.search || url.hash) {
    throw new TypeError(
      "`FABRIC_BASE_URL` must not contain a query string or fragment.",
    );
  }
  if (url.protocol !== "https:" && !isLoopback(url)) {
    throw new TypeError(
      "`FABRIC_BASE_URL` must use HTTPS except for loopback development servers.",
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
  if (typeof window !== "undefined" && window.document !== undefined) {
    throw new TypeError(
      "@fabric-messaging/sdk contains secret API keys and can only run in a trusted server environment.",
    );
  }
}

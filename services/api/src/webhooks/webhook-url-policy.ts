import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { invalidRequest } from "../http/api-error.js";

export interface ResolvedWebhookTarget {
  readonly url: URL;
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Resolve immediately before connecting. The HTTP client pins this result through its lookup
 * callback, closing the DNS-rebinding gap between validation and the outbound socket.
 */
export async function resolveWebhookTarget(
  rawUrl: string,
  allowPrivateNetworks: boolean,
): Promise<ResolvedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidRequest(
      "invalid_webhook_url",
      "Enter a valid webhook URL.",
      "url",
    );
  }
  if (url.username || url.password || url.hash) {
    throw invalidRequest(
      "unsafe_webhook_url",
      "Webhook URLs cannot contain credentials or fragments.",
      "url",
    );
  }
  if (url.protocol !== "https:" && !allowPrivateNetworks) {
    throw invalidRequest(
      "webhook_https_required",
      "Webhook endpoints must use HTTPS.",
      "url",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalidRequest(
      "invalid_webhook_url",
      "Webhook URLs must use HTTPS.",
      "url",
    );
  }

  const results = await lookup(url.hostname, { all: true, verbatim: true });
  const target = results[0];
  if (!target) {
    throw invalidRequest(
      "webhook_host_unresolved",
      "The webhook hostname could not be resolved.",
      "url",
    );
  }
  if (
    !allowPrivateNetworks &&
    results.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw invalidRequest(
      "unsafe_webhook_host",
      "Webhook endpoints must resolve only to public network addresses.",
      "url",
    );
  }
  if (target.family !== 4 && target.family !== 6) {
    throw invalidRequest(
      "webhook_host_unresolved",
      "The webhook hostname did not resolve to an IP address.",
      "url",
    );
  }
  return { url, address: target.address, family: target.family };
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a = 0, b = 0] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }
  return true;
}

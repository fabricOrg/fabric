import type { AppDb } from "@app/db";
import type { EngineDeps } from "@app/sms-engine";
import { ingestDlr } from "@app/sms-engine";
import { Logger } from "@nestjs/common";
import { notFound, unauthorized } from "../http/api-error.js";

type Row = Record<string, unknown>;

const logger = new Logger("SmsDlrIngest");

export async function ingestProviderDlr(input: {
  db: AppDb;
  providerSlug: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  live: EngineDeps;
  virtual: EngineDeps;
}): Promise<{ status: string }> {
  const deps =
    input.providerSlug === input.live.provider.slug
      ? input.live
      : input.providerSlug === input.virtual.provider.slug
        ? input.virtual
        : null;
  if (!deps) {
    // The wrong-slug case, and the one a misconfigured callback URL actually hits: the token was
    // right, so the caller is us, but the path names a provider no adapter answers to. Silent 404s
    // here are why a callback pointed at `/webhooks/dlr/arkesel` instead of `/arkesel-sms` is
    // indistinguishable from a carrier that never called.
    logger.warn(
      `DLR rejected: unknown provider '${safeSlug(input.providerSlug)}' (known: ${input.live.provider.slug}, ${input.virtual.provider.slug})`,
    );
    throw notFound("unknown_provider", `no provider '${input.providerSlug}'`);
  }

  const rawBody =
    typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    headers[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  if (!deps.provider.verifyWebhook({ headers, rawBody }, deps.creds ?? {})) {
    logger.warn(
      `DLR rejected: signature invalid for provider '${safeSlug(input.providerSlug)}'`,
    );
    throw unauthorized("invalid_signature", "DLR webhook signature invalid.");
  }

  const dlr = deps.provider.parseDlr(input.body);
  const tenantId = await input.db.withProviderRefLookup(
    dlr.providerRef,
    async (tx) => {
      const rows = (await tx`
      SELECT tenant_id FROM messages
      WHERE provider_slug = ${input.providerSlug} AND provider_ref = ${dlr.providerRef}`) as Row[];
      return rows[0]?.tenant_id ? String(rows[0].tenant_id) : null;
    },
  );
  if (!tenantId) {
    // Authenticated, well-formed, and about a message we do not have. Usually a callback pointed at
    // the wrong environment. The provider_ref is vendor-issued, carries no PII, and is the only
    // handle an operator can correlate against the vendor's own dashboard — so it is logged.
    logger.warn(
      `DLR rejected: no message for provider '${safeSlug(input.providerSlug)}' ref=${safeSlug(dlr.providerRef)}`,
    );
    throw notFound(
      "message_not_found",
      `no message for provider_ref ${dlr.providerRef}`,
    );
  }
  return { status: await ingestDlr(deps, tenantId, input.body) };
}

/** Caller-controlled values are stripped to the slug alphabet before they reach a log line. */
function safeSlug(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  const cleaned = value.replace(/[^a-zA-Z0-9._:-]/g, "");
  return cleaned.length === 0 ? "unrecognised" : cleaned.slice(0, 80);
}

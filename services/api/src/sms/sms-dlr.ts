import type { AppDb } from "@app/db";
import type { EngineDeps } from "@app/sms-engine";
import { ingestDlr } from "@app/sms-engine";
import { notFound, unauthorized } from "../http/api-error.js";

type Row = Record<string, unknown>;

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
  if (!deps)
    throw notFound("unknown_provider", `no provider '${input.providerSlug}'`);

  const rawBody =
    typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    headers[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  if (!deps.provider.verifyWebhook({ headers, rawBody }, deps.creds ?? {})) {
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
    throw notFound(
      "message_not_found",
      `no message for provider_ref ${dlr.providerRef}`,
    );
  }
  return { status: await ingestDlr(deps, tenantId, input.body) };
}

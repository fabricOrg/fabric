import type { SendEmailApiResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import { notFound, unauthorized } from "../http/api-error.js";
import type { EmailRuntimeService } from "./email-runtime.service.js";
import { verifySesSnsEvent } from "./ses-sns-verifier.js";

type Row = Record<string, unknown>;

export async function ingestSesEvent(input: {
  db: AppDb;
  runtime: EmailRuntimeService | undefined;
  body: unknown;
  resolve: (
    tenantId: string,
    messageId: string,
    status: SendEmailApiResponse["status"],
    detail: { errorCode?: string },
  ) => Promise<SendEmailApiResponse["status"]>;
}): Promise<{ status: string }> {
  if (!input.runtime) {
    throw unauthorized(
      "email_provider_unavailable",
      "The Email provider is unavailable.",
    );
  }
  const runtime = await input.runtime.resolve("live");
  const topicArn = runtime.creds.snsTopicArn;
  if (!topicArn) {
    throw unauthorized(
      "email_webhook_not_configured",
      "The Email event topic is not configured.",
    );
  }
  let event: Awaited<ReturnType<typeof verifySesSnsEvent>>;
  try {
    event = await verifySesSnsEvent(input.body, topicArn);
  } catch {
    throw unauthorized(
      "invalid_email_webhook_signature",
      "The Email event signature is invalid.",
    );
  }
  if (!event) return { status: "ignored" };

  const owner = await input.db.withProviderRefLookup(
    event.providerRef,
    async (tx) => {
      const rows = (await tx`
        SELECT id, tenant_id FROM email_messages
        WHERE provider_slug = ${runtime.provider.slug}
          AND provider_ref = ${event.providerRef}
        LIMIT 1`) as Row[];
      const row = rows[0];
      return row?.tenant_id
        ? { tenantId: String(row.tenant_id), messageId: String(row.id) }
        : null;
    },
  );
  if (!owner) {
    throw notFound(
      "email_message_not_found",
      "No Email message matches this provider event.",
    );
  }
  return {
    status: await input.resolve(
      owner.tenantId,
      owner.messageId,
      event.status,
      event.errorCode ? { errorCode: event.errorCode } : {},
    ),
  };
}

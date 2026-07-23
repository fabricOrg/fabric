// Managed Email accept/persist path (SDK-007 slice 4a-ii), split out of email.service.ts to keep it
// under the length guard. Mirrors the SMS engine's prepareSend: in one tenant tx it inserts the
// email_messages row (id = deliveryId), reserves the wallet keyed on that id, records the dispatch
// intent, and calls the channel-neutral persistManagedAcceptance. Replay-check-first => no
// double-reserve; every insert is ON CONFLICT DO NOTHING so a concurrent same-key race collapses to
// one delivery. Accept only — the dispatch worker is slice 4b.

import { sendEmailRequest } from "@app/contracts";
import type { AppDb } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import {
  findManagedReplay,
  type ManagedSendContext,
  persistManagedAcceptance,
} from "@app/sms-engine";
import { reserve } from "@app/wallet";
import { invalidRequest } from "../http/api-error.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

export interface ManagedEmailAcceptDeps {
  db: AppDb;
  vault: PiiVaultService;
  providerSlug: string;
  /** Sandbox gate: rejects a non-sandbox environment (live Email is not configured). */
  assertSandbox: (context: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  }) => Promise<void>;
}

export interface ManagedEmailAcceptInput {
  tenantId: string;
  applicationId: string;
  environmentId: string;
  deliveryId: string;
  to: string;
  from: string;
  subject: string;
  text: string | null;
  html: string | null;
  currency: string;
  costMinor: string;
  managed: ManagedSendContext;
}

export async function acceptManagedEmail(
  deps: ManagedEmailAcceptDeps,
  input: ManagedEmailAcceptInput,
): Promise<void> {
  await deps.assertSandbox(input);
  // Store the rendered content in the exact SendEmailRequest shape the dispatch worker reads back.
  const content = sendEmailRequest.safeParse({
    to: input.to,
    from: input.from,
    subject: input.subject,
    ...(input.text ? { text: input.text } : {}),
    ...(input.html ? { html: input.html } : {}),
  });
  if (!content.success) {
    throw invalidRequest(
      "email_content_invalid",
      "The rendered email content is invalid.",
    );
  }
  const subjectId = await deps.vault.subjectForEmail(input.tenantId, input.to);
  const contentPiiId = await deps.vault.put(
    input.tenantId,
    subjectId,
    "body",
    JSON.stringify(content.data),
  );
  await deps.db.withTenant(input.tenantId, async (tx) => {
    const replay = await findManagedReplay(tx, {
      managed: input.managed,
      applicationId: input.applicationId,
      environmentId: input.environmentId,
    });
    if (replay) return;
    await tx`
      INSERT INTO email_messages (
        id, tenant_id, application_id, environment_id, subject_id, content_pii_id,
        status, status_rank, provider_slug
      ) VALUES (
        ${input.deliveryId}, current_setting('app.tenant_id')::uuid,
        ${input.applicationId}, ${input.environmentId}, ${subjectId}, ${contentPiiId},
        'queued', ${STATUS_RANK.queued}, ${deps.providerSlug}
      ) ON CONFLICT (id) DO NOTHING`;
    await reserve(tx, {
      currency: input.currency,
      amountMinor: BigInt(input.costMinor),
      idempotencyKey: `reserve:${input.deliveryId}`,
      referenceId: input.deliveryId,
    });
    await tx`
      INSERT INTO email_dispatches (message_id, tenant_id)
      VALUES (${input.deliveryId}, current_setting('app.tenant_id')::uuid)
      ON CONFLICT (message_id) DO NOTHING`;
    await persistManagedAcceptance(tx, {
      managed: input.managed,
      currency: input.currency,
      channel: "email",
      emailMessageId: input.deliveryId,
      costMinor: input.costMinor,
      applicationId: input.applicationId,
      environmentId: input.environmentId,
    });
  });
}

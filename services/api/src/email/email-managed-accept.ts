// Managed Email accept/persist path (SDK-007 slice 4a-ii), split out of email.service.ts to keep it
// under the length guard. Mirrors the SMS engine's prepareSend: in one tenant tx it inserts the
// email_messages row (id = deliveryId), consumes the workspace sandbox allowance, records the
// dispatch intent, and calls the channel-neutral persistManagedAcceptance. Replay-check-first =>
// no double-consume; every insert is ON CONFLICT DO NOTHING so a concurrent same-key race collapses to
// one delivery. Accept only — the dispatch worker is slice 4b.

import { sendEmailRequest } from "@app/contracts";
import type { AppDb, PricingSnapshot, TenantTx } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import {
  findManagedReplay,
  type ManagedSendContext,
  persistManagedAcceptance,
} from "@app/sms-engine";
import { invalidRequest } from "../http/api-error.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

export interface ManagedEmailAcceptDeps {
  db: AppDb;
  vault: PiiVaultService;
  preparation: {
    backing: "wallet" | "sandbox_allowance";
    providerSlug: string;
    currency: string;
    costMinor: bigint;
    pricingSnapshot?: PricingSnapshot;
  };
  consumeSandboxAllowance: (
    tx: TenantTx,
    input: {
      channel: "email";
      units: bigint;
      referenceId: string;
      applicationId: string;
      environmentId: string;
    },
  ) => Promise<void>;
  reserveWallet: (
    tx: TenantTx,
    input: {
      currency: string;
      amountMinor: bigint;
      messageId: string;
    },
  ) => Promise<void>;
  holdTokens?: (
    tx: TenantTx,
    input: { currency: string; messageId: string },
  ) => Promise<boolean>;
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
    let backing: "wallet" | "tokens" | "sandbox_allowance" =
      deps.preparation.backing;
    if (
      backing === "wallet" &&
      (await deps.holdTokens?.(tx, {
        currency: deps.preparation.currency,
        messageId: input.deliveryId,
      }))
    ) {
      backing = "tokens";
    }
    await tx`
      INSERT INTO email_messages (
        id, tenant_id, application_id, environment_id, subject_id, content_pii_id,
        status, status_rank, backing, provider_slug, cost_minor, currency, pricing_snapshot
      ) VALUES (
        ${input.deliveryId}, current_setting('app.tenant_id')::uuid,
        ${input.applicationId}, ${input.environmentId}, ${subjectId}, ${contentPiiId},
        'queued', ${STATUS_RANK.queued}, ${backing},
        ${deps.preparation.providerSlug}, ${deps.preparation.costMinor.toString()}::bigint,
        ${deps.preparation.currency},
        ${deps.preparation.pricingSnapshot ? JSON.stringify(deps.preparation.pricingSnapshot) : null}::jsonb
      ) ON CONFLICT (id) DO NOTHING`;
    if (backing === "sandbox_allowance") {
      await deps.consumeSandboxAllowance(tx, {
        channel: "email",
        units: 1n,
        referenceId: input.deliveryId,
        applicationId: input.applicationId,
        environmentId: input.environmentId,
      });
    } else if (backing === "wallet") {
      await deps.reserveWallet(tx, {
        currency: deps.preparation.currency,
        amountMinor: deps.preparation.costMinor,
        messageId: input.deliveryId,
      });
    }
    await tx`
      INSERT INTO email_dispatches (message_id, tenant_id)
      VALUES (${input.deliveryId}, current_setting('app.tenant_id')::uuid)
      ON CONFLICT (message_id) DO NOTHING`;
    await persistManagedAcceptance(tx, {
      managed: input.managed,
      currency: deps.preparation.currency,
      channel: "email",
      emailMessageId: input.deliveryId,
      costMinor: deps.preparation.costMinor.toString(),
      applicationId: input.applicationId,
      environmentId: input.environmentId,
    });
  });
}

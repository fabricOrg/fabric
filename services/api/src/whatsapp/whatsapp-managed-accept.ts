// Managed WhatsApp accept/persist path (ADR-0014), split out of whatsapp.service.ts to keep it under
// the length guard. Mirrors acceptManagedEmail: in one tenant tx it inserts the whatsapp_messages row
// (id = deliveryId), takes the sandbox allowance or the wallet reserve, records the dispatch intent,
// and calls the channel-neutral persistManagedAcceptance. Replay-check-first => no double-consume;
// every insert is ON CONFLICT DO NOTHING so a concurrent same-key race collapses to one delivery.
// Accept only — the dispatch worker is unchanged and reads this row exactly as a direct send's.

import { whatsappSendRequest } from "@app/contracts";
import type { AppDb, PricingSnapshot, TenantTx } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import {
  findManagedReplay,
  type ManagedSendContext,
  persistManagedAcceptance,
} from "@app/sms-engine";
import { invalidRequest } from "../http/api-error.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

export interface ManagedWhatsappAcceptDeps {
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
      channel: "whatsapp";
      units: bigint;
      referenceId: string;
      applicationId: string;
      environmentId: string;
    },
  ) => Promise<void>;
  reserveWallet: (
    tx: TenantTx,
    input: { currency: string; amountMinor: bigint; messageId: string },
  ) => Promise<void>;
}

export interface ManagedWhatsappAcceptInput {
  tenantId: string;
  applicationId: string;
  environmentId: string;
  deliveryId: string;
  to: string;
  templateName: string;
  templateLanguage: string;
  templateCategory: "marketing" | "utility" | "authentication";
  /** Rendered POSITIONAL body parameters, in template order (see @app/domain previewWhatsapp). */
  parameters: readonly string[];
  currency: string;
  costMinor: string;
  managed: ManagedSendContext;
}

export async function acceptManagedWhatsapp(
  deps: ManagedWhatsappAcceptDeps,
  input: ManagedWhatsappAcceptInput,
): Promise<void> {
  // Store the resolved binding in the exact WhatsappSendRequest shape the dispatch worker reads back,
  // so a managed message and a direct one are indistinguishable downstream — one dispatch path, not two.
  const content = whatsappSendRequest.safeParse({
    to: input.to,
    template_name: input.templateName,
    template_language: input.templateLanguage,
    template_category: input.templateCategory,
    variables: [...input.parameters],
    currency: input.currency,
  });
  if (!content.success) {
    throw invalidRequest(
      "whatsapp_content_invalid",
      "The resolved WhatsApp template binding is invalid.",
    );
  }
  const subjectId = await deps.vault.subjectForPhone(input.tenantId, input.to);
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
    const { backing, costMinor, currency, providerSlug, pricingSnapshot } =
      deps.preparation;
    await tx`
      INSERT INTO whatsapp_messages (
        id, tenant_id, application_id, environment_id, subject_id, content_pii_id,
        template_name, template_language, template_category, status, status_rank,
        backing, provider_slug, cost_minor, currency, pricing_snapshot
      ) VALUES (
        ${input.deliveryId}, current_setting('app.tenant_id')::uuid,
        ${input.applicationId}, ${input.environmentId}, ${subjectId}, ${contentPiiId},
        ${input.templateName}, ${input.templateLanguage}, ${input.templateCategory},
        'queued', ${STATUS_RANK.queued}, ${backing}, ${providerSlug},
        ${costMinor.toString()}::bigint, ${currency},
        ${pricingSnapshot ? JSON.stringify(pricingSnapshot) : null}::jsonb
      ) ON CONFLICT (id) DO NOTHING`;
    if (backing === "sandbox_allowance") {
      await deps.consumeSandboxAllowance(tx, {
        channel: "whatsapp",
        units: 1n,
        referenceId: input.deliveryId,
        applicationId: input.applicationId,
        environmentId: input.environmentId,
      });
    } else {
      await deps.reserveWallet(tx, {
        currency,
        amountMinor: costMinor,
        messageId: input.deliveryId,
      });
    }
    await tx`
      INSERT INTO whatsapp_dispatches (message_id, tenant_id)
      VALUES (${input.deliveryId}, current_setting('app.tenant_id')::uuid)
      ON CONFLICT (message_id) DO NOTHING`;
    await persistManagedAcceptance(tx, {
      managed: input.managed,
      currency,
      channel: "whatsapp",
      whatsappMessageId: input.deliveryId,
      costMinor: costMinor.toString(),
      applicationId: input.applicationId,
      environmentId: input.environmentId,
    });
  });
}

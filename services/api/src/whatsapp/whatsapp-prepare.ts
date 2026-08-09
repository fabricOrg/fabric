import { randomUUID } from "node:crypto";
import type { WhatsappSendRequest } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { WhatsAppSenderPlugin } from "@app/integrations";
import { STATUS_RANK } from "@app/integrations";
import { reserve } from "@app/wallet";
import { invalidRequest } from "../http/api-error.js";
import {
  EffectivePricingUnavailableError,
  PricingMarginViolationError,
} from "../pricing/effective-pricing.js";
import type { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import type { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { destinationCountry } from "../sms/sms-compliance.js";
import { resolveWhatsappEnvironment } from "./whatsapp-environment.js";
import type { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import type { WhatsappTemplateService } from "./whatsapp-template.service.js";

export async function prepareWhatsapp(input: {
  db: AppDb;
  vault: PiiVaultService;
  sandboxAllowance: SandboxAllowanceService;
  runtime: WhatsappRuntimeService;
  templates?: WhatsappTemplateService;
  effectivePricing?: EffectivePricingService;
  context: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  };
  content: WhatsappSendRequest;
}): Promise<string> {
  const mode = await resolveWhatsappEnvironment(input.db, input.context);
  const resolved = await input.runtime.resolve(mode);
  if (mode === "live") {
    // Template state is a Meta-owned control-plane cache. A fresh negative blocks before money is
    // reserved; an absent/stale row fails open so our sync lag does not become a channel outage.
    await input.templates?.assertSendable({
      tenantId: input.context.tenantId,
      creds: resolved.creds,
      templateName: input.content.template_name,
      templateLanguage: input.content.template_language,
    });
  }
  const quote =
    mode === "live"
      ? await resolveWhatsappQuote({
          pricing: input.effectivePricing,
          tenantId: input.context.tenantId,
          provider: resolved.provider,
          content: input.content,
        })
      : undefined;
  const subjectId = await input.vault.subjectForPhone(
    input.context.tenantId,
    input.content.to,
  );
  const contentPiiId = await input.vault.put(
    input.context.tenantId,
    subjectId,
    "body",
    JSON.stringify(input.content),
  );
  return input.db.withTenant(input.context.tenantId, async (tx) => {
    const messageId = randomUUID();
    const backing = mode === "sandbox" ? "sandbox_allowance" : "wallet";
    if (mode === "sandbox") {
      await input.sandboxAllowance.consume(tx, {
        channel: "whatsapp",
        units: 1n,
        referenceId: messageId,
        applicationId: input.context.applicationId,
        environmentId: input.context.environmentId,
      });
    } else if (quote) {
      await reserve(tx, {
        currency: quote.currency,
        amountMinor: quote.totalPriceMinor,
        idempotencyKey: `reserve:${messageId}`,
        referenceId: messageId,
      });
    }
    await tx`
      INSERT INTO whatsapp_messages (
        id, tenant_id, application_id, environment_id, subject_id, content_pii_id,
        template_name, template_language, template_category, status, status_rank,
        backing, provider_slug, cost_minor, currency, pricing_snapshot
      ) VALUES (
        ${messageId}, current_setting('app.tenant_id')::uuid, ${input.context.applicationId},
        ${input.context.environmentId}, ${subjectId}, ${contentPiiId},
        ${input.content.template_name}, ${input.content.template_language},
        ${input.content.template_category}, 'queued', ${STATUS_RANK.queued}, ${backing},
        ${resolved.provider.slug}, ${quote?.totalPriceMinor.toString() ?? "0"}::bigint,
        ${quote?.currency ?? input.content.currency}, ${quote ? JSON.stringify(quote.snapshot) : null}::jsonb
      )`;
    await tx`
      INSERT INTO whatsapp_dispatches (message_id, tenant_id)
      VALUES (${messageId}, current_setting('app.tenant_id')::uuid)`;
    await tx`
      INSERT INTO outbox_events (
        tenant_id, application_id, environment_id, event_type, payload
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${input.context.applicationId},
        ${input.context.environmentId}, 'message.created',
        ${JSON.stringify({ message_id: messageId, channel: "whatsapp", status: "queued" })}::jsonb
      )`;
    return messageId;
  });
}

async function resolveWhatsappQuote(input: {
  pricing: EffectivePricingService | undefined;
  tenantId: string;
  provider: WhatsAppSenderPlugin;
  content: WhatsappSendRequest;
}) {
  try {
    if (!input.pricing) {
      throw new EffectivePricingUnavailableError(
        "The effective-pricing service is unavailable.",
      );
    }
    return await input.pricing.quote({
      accountId: input.tenantId,
      channel: "whatsapp",
      units: 1n,
      providerVendor: input.provider.slug,
      destinationCountry: destinationCountry(input.content.to),
      trafficClass: input.content.template_category,
    });
  } catch (error) {
    if (error instanceof PricingMarginViolationError) {
      throw invalidRequest(
        error.code,
        "WhatsApp sending is unavailable because its configured margin floor is not satisfied.",
      );
    }
    if (error instanceof EffectivePricingUnavailableError) {
      throw invalidRequest(
        error.code,
        "WhatsApp sending is unavailable because no safe effective price is configured.",
      );
    }
    throw error;
  }
}

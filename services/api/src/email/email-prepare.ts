import type { SendEmailRequest } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { EmailSenderPlugin } from "@app/integrations";
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
import { resolveEmailEnvironment } from "./email-environment.js";
import type { EmailRuntimeService } from "./email-runtime.service.js";

type Row = Record<string, unknown>;

export async function prepareEmail(input: {
  db: AppDb;
  vault: PiiVaultService;
  sandboxAllowance: SandboxAllowanceService;
  runtime?: EmailRuntimeService;
  effectivePricing?: EffectivePricingService;
  sandboxProvider: EmailSenderPlugin;
  context: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  };
  content: SendEmailRequest;
}): Promise<string> {
  const mode = await resolveEmailEnvironment(input.db, input.context);
  const resolved =
    mode === "sandbox" && !input.runtime
      ? { provider: input.sandboxProvider, creds: {} }
      : await input.runtime?.resolve(mode);
  if (!resolved) {
    throw invalidRequest(
      "live_email_not_configured",
      "Live Email requires an active provider with validated credentials.",
    );
  }
  const quote =
    mode === "live"
      ? await resolveEmailQuote(
          input.effectivePricing,
          input.context.tenantId,
          resolved.provider.slug,
        )
      : undefined;
  const subjectId = await input.vault.subjectForEmail(
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
    const rows = (await tx`
      INSERT INTO email_messages (
        tenant_id, application_id, environment_id, subject_id, content_pii_id,
        status, status_rank, backing, provider_slug, cost_minor, currency, pricing_snapshot
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${input.context.applicationId},
        ${input.context.environmentId}, ${subjectId}, ${contentPiiId}, 'queued',
        ${STATUS_RANK.queued}, ${mode === "sandbox" ? "sandbox_allowance" : "wallet"},
        ${resolved.provider.slug}, ${quote?.totalPriceMinor.toString() ?? "0"}::bigint,
        ${quote?.currency ?? "GHS"}, ${quote ? JSON.stringify(quote.snapshot) : null}::jsonb
      ) RETURNING id`) as Row[];
    const messageId = String(rows[0]?.id);
    if (mode === "sandbox") {
      await input.sandboxAllowance.consume(tx, {
        channel: "email",
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
      INSERT INTO email_dispatches (message_id, tenant_id)
      VALUES (${messageId}, current_setting('app.tenant_id')::uuid)`;
    await tx`
      INSERT INTO outbox_events (
        tenant_id, application_id, environment_id, event_type, payload
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${input.context.applicationId},
        ${input.context.environmentId}, 'message.created',
        ${JSON.stringify({ message_id: messageId, channel: "email", status: "queued" })}::jsonb
      )`;
    return messageId;
  });
}

export async function resolveEmailQuote(
  pricing: EffectivePricingService | undefined,
  tenantId: string,
  providerVendor: string,
) {
  try {
    if (!pricing) {
      throw new EffectivePricingUnavailableError(
        "The effective-pricing service is unavailable.",
      );
    }
    return await pricing.quote({
      accountId: tenantId,
      channel: "email",
      units: 1n,
      providerVendor,
      trafficClass: "transactional",
    });
  } catch (error) {
    if (error instanceof PricingMarginViolationError) {
      throw invalidRequest(
        error.code,
        "Email sending is unavailable because its configured margin floor is not satisfied.",
      );
    }
    if (error instanceof EffectivePricingUnavailableError) {
      throw invalidRequest(
        error.code,
        "Email sending is unavailable because no safe effective price is configured.",
      );
    }
    throw error;
  }
}

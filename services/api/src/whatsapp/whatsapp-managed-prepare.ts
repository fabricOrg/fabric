import type { AppDb } from "@app/db";
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
import {
  acceptManagedWhatsapp,
  type ManagedWhatsappAcceptInput,
} from "./whatsapp-managed-accept.js";
import type { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import type { WhatsappTemplateService } from "./whatsapp-template.service.js";

/**
 * Managed WhatsApp preparation (ADR-0014) — the mirror of prepareManagedEmail, and it resolves the
 * SAME environment/template/pricing questions the direct send path (prepareWhatsapp) resolves. Two
 * things worth stating because they are easy to get wrong:
 *
 * - The LIVE price comes from the effective-pricing engine, not from the preview. The preview's cost is
 *   a price-book quote made without a resolved provider; the send knows the vendor and the destination,
 *   so it re-quotes and enforces `limits.max_cost` against the number actually charged. The preview cost
 *   is the sandbox fallback only.
 * - Template sendability is checked BEFORE money moves, and only in live mode, matching the direct path:
 *   a fresh negative blocks; an absent or stale row fails open so our sync lag is not a channel outage.
 */
export async function prepareManagedWhatsapp(input: {
  db: AppDb;
  vault: PiiVaultService;
  sandboxAllowance: SandboxAllowanceService;
  runtime: WhatsappRuntimeService;
  templates?: WhatsappTemplateService;
  effectivePricing?: EffectivePricingService;
  message: ManagedWhatsappAcceptInput;
}): Promise<void> {
  const mode = await resolveWhatsappEnvironment(input.db, input.message);
  const resolved = await input.runtime.resolve(mode);
  if (mode === "live") {
    await input.templates?.assertSendable({
      tenantId: input.message.tenantId,
      creds: resolved.creds,
      templateName: input.message.templateName,
      templateLanguage: input.message.templateLanguage,
    });
  }
  const quote =
    mode === "live"
      ? await resolveManagedWhatsappQuote({
          pricing: input.effectivePricing,
          tenantId: input.message.tenantId,
          providerVendor: resolved.provider.slug,
          to: input.message.to,
          category: input.message.templateCategory,
        })
      : undefined;
  if (
    quote &&
    input.message.managed.maxCostMinor !== undefined &&
    quote.totalPriceMinor > BigInt(input.message.managed.maxCostMinor)
  ) {
    throw invalidRequest(
      "managed_cost_limit_exceeded",
      "The WhatsApp price exceeds this delivery's cost limit.",
    );
  }

  await acceptManagedWhatsapp(
    {
      db: input.db,
      vault: input.vault,
      preparation: {
        backing: mode === "sandbox" ? "sandbox_allowance" : "wallet",
        providerSlug: resolved.provider.slug,
        currency: quote?.currency ?? input.message.currency,
        costMinor: quote?.totalPriceMinor ?? BigInt(input.message.costMinor),
        ...(quote ? { pricingSnapshot: quote.snapshot } : {}),
      },
      consumeSandboxAllowance: (tx, context) =>
        input.sandboxAllowance.consume(tx, context),
      reserveWallet: async (tx, walletInput) => {
        await reserve(tx, {
          currency: walletInput.currency,
          amountMinor: walletInput.amountMinor,
          idempotencyKey: `reserve:${walletInput.messageId}`,
          referenceId: walletInput.messageId,
        });
      },
    },
    input.message,
  );
}

async function resolveManagedWhatsappQuote(input: {
  pricing: EffectivePricingService | undefined;
  tenantId: string;
  providerVendor: string;
  to: string;
  category: "marketing" | "utility" | "authentication";
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
      providerVendor: input.providerVendor,
      destinationCountry: destinationCountry(input.to),
      trafficClass: input.category,
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

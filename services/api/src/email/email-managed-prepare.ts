import type { AppDb } from "@app/db";
import type { EmailSenderPlugin } from "@app/integrations";
import { reserve } from "@app/wallet";
import { invalidRequest } from "../http/api-error.js";
import type { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import type { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { holdTokens } from "../tokens/token-holds.js";
import { resolveEmailEnvironment } from "./email-environment.js";
import {
  acceptManagedEmail,
  type ManagedEmailAcceptInput,
} from "./email-managed-accept.js";
import { resolveEmailQuote } from "./email-prepare.js";
import type { EmailRuntimeService } from "./email-runtime.service.js";

export async function prepareManagedEmail(input: {
  db: AppDb;
  vault: PiiVaultService;
  sandboxAllowance: SandboxAllowanceService;
  sandboxProvider: EmailSenderPlugin;
  runtime?: EmailRuntimeService;
  effectivePricing?: EffectivePricingService;
  message: ManagedEmailAcceptInput;
}): Promise<void> {
  const mode = await resolveEmailEnvironment(input.db, input.message);
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
          input.message.tenantId,
          resolved.provider.slug,
        )
      : undefined;
  if (
    quote &&
    input.message.managed.maxCostMinor !== undefined &&
    quote.totalPriceMinor > BigInt(input.message.managed.maxCostMinor)
  ) {
    throw invalidRequest(
      "managed_cost_limit_exceeded",
      "The Email price exceeds this delivery's cost limit.",
    );
  }

  await acceptManagedEmail(
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
      holdTokens: async (tx, tokenInput) => {
        const held = await holdTokens(tx, {
          channel: "email",
          currency: tokenInput.currency,
          quantity: 1n,
          referenceId: tokenInput.messageId,
          compatibility: {
            providerVendor: resolved.provider.slug,
            trafficClass: "transactional",
          },
        });
        return held.held;
      },
    },
    input.message,
  );
}

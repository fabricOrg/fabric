import { encodeAndSegment } from "@app/domain";
import type { SendInput } from "@app/sms-engine";
import { invalidRequest } from "../http/api-error.js";
import {
  EffectivePricingUnavailableError,
  PricingMarginViolationError,
} from "../pricing/effective-pricing.js";
import type { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { smsDestinationCountry } from "./sms-destination.js";

export async function resolveLiveSmsPricing(input: {
  pricing: EffectivePricingService | undefined;
  tenantId: string;
  body: string;
  to: string;
  requestedCurrency: string;
  providerVendor: string;
  messageClass: "transactional" | "promotional";
}): Promise<NonNullable<SendInput["pricing"]>> {
  try {
    if (!input.pricing) {
      throw new EffectivePricingUnavailableError(
        "The effective-pricing service is unavailable.",
      );
    }
    const destinationCountry = smsDestinationCountry(input.to);
    const quote = await input.pricing.quote({
      accountId: input.tenantId,
      channel: "sms",
      units: BigInt(encodeAndSegment(input.body).segments),
      providerVendor: input.providerVendor,
      trafficClass: input.messageClass,
      ...(destinationCountry ? { destinationCountry } : {}),
    });
    if (input.requestedCurrency !== quote.currency) {
      throw invalidRequest(
        "billing_currency_mismatch",
        `This account is billed in ${quote.currency}.`,
        "currency",
      );
    }
    return {
      currency: quote.currency,
      costMinor: quote.totalPriceMinor,
      snapshot: quote.snapshot,
    };
  } catch (error) {
    if (error instanceof PricingMarginViolationError) {
      throw invalidRequest(
        error.code,
        "SMS sending is unavailable because its configured margin floor is not satisfied.",
      );
    }
    if (error instanceof EffectivePricingUnavailableError) {
      throw invalidRequest(
        error.code,
        "SMS sending is unavailable because no safe effective price is configured.",
      );
    }
    throw error;
  }
}

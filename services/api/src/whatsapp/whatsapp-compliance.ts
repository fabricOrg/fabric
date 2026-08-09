import type { WhatsappTemplateCategory } from "@app/contracts";
import type { ConsentService } from "../consent/consent.service.js";
import { promoWindowOpen } from "../consent/consent.service.js";
import { invalidRequest } from "../http/api-error.js";
import { destinationCountry } from "../sms/sms-compliance.js";

export async function assertWhatsappCompliant(input: {
  consent: ConsentService;
  tenantId: string;
  to: string;
  category: WhatsappTemplateCategory;
  now?: Date;
}): Promise<void> {
  const messageClass =
    input.category === "marketing" ? "promotional" : "transactional";
  if (
    await input.consent.isSuppressed(input.tenantId, input.to, messageClass)
  ) {
    throw invalidRequest(
      "recipient_opted_out",
      "This recipient has opted out of this class of messages.",
      "to",
    );
  }
  if (
    input.category === "marketing" &&
    !promoWindowOpen(input.now ?? new Date(), destinationCountry(input.to))
  ) {
    throw invalidRequest(
      "promo_quiet_hours",
      "Marketing WhatsApp templates are outside the allowed delivery window.",
      "template_category",
    );
  }
}

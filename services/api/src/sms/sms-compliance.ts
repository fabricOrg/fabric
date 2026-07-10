import type { ConsentService } from "../consent/consent.service.js";
import { promoWindowOpen } from "../consent/consent.service.js";
import { invalidRequest } from "../http/api-error.js";
import type { SendersService } from "../senders/senders.service.js";

/**
 * Send-path compliance gates (E10-S4/S5), split from SmsService for the file-length guard.
 * Order matters and is deliberate:
 *   1. sender registration (LIVE tenants only — sandbox rides the fake provider, no carrier);
 *   2. recipient suppression (checked before quiet hours so opt-out outcomes are deterministic);
 *   3. promotional window (08:00–20:00 local; transactional/OTP bypasses 24/7 per NCC 2442).
 * All three fail CLOSED: compliance gates must never let an outage push non-compliant traffic.
 */
export async function assertSendCompliant(opts: {
  senders: SendersService;
  consent: ConsentService;
  tenantId: string;
  to: string;
  senderId: string;
  messageClass: "transactional" | "promotional";
  sandbox: boolean;
}): Promise<void> {
  const country = destinationCountry(opts.to);
  if (!opts.sandbox) {
    const registered = await opts.senders.isActiveSender(
      opts.tenantId,
      opts.senderId,
      country,
    );
    if (!registered) {
      throw invalidRequest(
        "sender_not_registered",
        `Sender id '${opts.senderId}' is not registered (active) for ${country}. Register it under Senders first.`,
        "senderId",
      );
    }
  }
  // Consent + quiet hours apply to EVERY tenant (sandbox previews real compliance behavior —
  // the fake provider changes delivery, never legality).
  if (
    await opts.consent.isSuppressed(opts.tenantId, opts.to, opts.messageClass)
  ) {
    throw invalidRequest(
      "recipient_opted_out",
      "This recipient has opted out of this class of messages.",
      "to",
    );
  }
  if (
    opts.messageClass === "promotional" &&
    !promoWindowOpen(new Date(), country)
  ) {
    throw invalidRequest(
      "promo_quiet_hours",
      "Promotional messages are outside the allowed window (GH 08:00-19:00, never Sundays; NG 08:00-20:00 WAT). Send later or mark genuinely transactional traffic as such.",
      "class",
    );
  }
}

/** Destination country from the E.164 prefix — the two launch markets; anything else maps to GH
 *  until more corridors open (a send there will simply require a GH registration). */
export function destinationCountry(to: string): string {
  if (to.startsWith("+234")) return "NG";
  return "GH";
}

import type { ConsentService } from "../consent/consent.service.js";
import { promoWindowOpen } from "../consent/consent.service.js";
import { invalidRequest } from "../http/api-error.js";
import type { SendersService } from "../senders/senders.service.js";

export interface ComplianceNotice {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ComplianceAssessment {
  readonly senderStatus:
    | "sandbox"
    | "active"
    | "pending"
    | "rejected"
    | "unregistered"
    | "not_evaluated";
  readonly blockers: readonly ComplianceNotice[];
  readonly warnings: readonly ComplianceNotice[];
}

interface ComplianceInput {
  senders: SendersService;
  consent: ConsentService;
  tenantId: string;
  to?: string;
  senderId: string;
  messageClass: "transactional" | "promotional";
  virtual: boolean;
  now?: Date;
}

/** Read-only assessment shared by preview and send; callers decide whether blockers are thrown. */
export async function assessSendCompliance(
  opts: ComplianceInput,
): Promise<ComplianceAssessment> {
  if (!opts.to) {
    return {
      senderStatus: opts.virtual ? "sandbox" : "not_evaluated",
      blockers: [],
      warnings: [
        {
          path: "to",
          code: "recipient_not_provided",
          message:
            "Add a recipient to evaluate sender registration, consent, and quiet hours.",
        },
      ],
    };
  }

  const blockers: ComplianceNotice[] = [];
  const country = destinationCountry(opts.to);
  const senderStatus = opts.virtual
    ? "sandbox"
    : await opts.senders.senderStatus(opts.tenantId, opts.senderId, country);
  if (!opts.virtual && senderStatus !== "active") {
    blockers.push({
      path: "sender_id",
      code: "sender_not_registered",
      message: `The sender is not active for ${country}.`,
    });
  }
  if (
    await opts.consent.isSuppressed(opts.tenantId, opts.to, opts.messageClass)
  ) {
    blockers.push({
      path: "to",
      code: "recipient_opted_out",
      message: "This recipient has opted out of this class of messages.",
    });
  }
  if (
    opts.messageClass === "promotional" &&
    !promoWindowOpen(opts.now ?? new Date(), country)
  ) {
    blockers.push({
      path: "class",
      code: "promo_quiet_hours",
      message: "Promotional messages are outside the allowed delivery window.",
    });
  }
  return { senderStatus, blockers, warnings: [] };
}

/** The send path fails closed on the first deterministic blocker from the shared assessment. */
export async function assertSendCompliant(
  opts: ComplianceInput & { to: string },
): Promise<void> {
  const assessment = await assessSendCompliance(opts);
  const blocker = assessment.blockers[0];
  if (blocker)
    throw invalidRequest(blocker.code, blocker.message, blocker.path);
}

/** Destination country from the E.164 prefix; launch corridors are Ghana and Nigeria. */
export function destinationCountry(to: string): string {
  if (to.startsWith("+234")) return "NG";
  return "GH";
}

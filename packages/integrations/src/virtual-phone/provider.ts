import type { MessageStatus } from "@app/contracts";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  NormalizedMessage,
  ProviderResult,
  RequestContext,
  SmsSenderPlugin,
} from "../plugin.js";
import { PLATFORM_FAULT_CAUSES } from "../status.js";

interface VirtualDlr {
  providerRef: string;
  status: MessageStatus;
  occurredAt: string;
  segments: number;
  errorCode?: string;
  faultCause?: "internal_error";
}

export class VirtualPhoneProvider implements SmsSenderPlugin {
  readonly slug = "virtual-phone";
  readonly capability = "sms" as const;
  readonly version = "1.0.0";
  readonly configSchema = {};
  // Successful virtual sends reserve through the real wallet path, then refund at the terminal.
  // The 0000 carrier-rejection simulation is deliberately billable to rehearse that real outcome.
  readonly billableStatuses: readonly MessageStatus[] = ["undelivered"];
  readonly platformFaultExemptions = PLATFORM_FAULT_CAUSES;

  supports(_ctx: RequestContext): boolean {
    return true;
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  send(message: NormalizedMessage, _creds: Creds): Promise<ProviderResult> {
    return Promise.resolve({
      providerRef: `virtual-${message.messageId}`,
      status: "accepted",
      raw: { virtual: true },
    });
  }

  delivered(message: NormalizedMessage): VirtualDlr {
    const suffix = message.to.slice(-4);
    const status: MessageStatus =
      suffix === "0000"
        ? "undelivered"
        : suffix === "0001"
          ? "failed"
          : "delivered";
    return {
      providerRef: `virtual-${message.messageId}`,
      status,
      occurredAt: new Date().toISOString(),
      segments: message.segments,
      ...(suffix === "0000" ? { errorCode: "virtual_carrier_rejected" } : {}),
      ...(suffix === "0001"
        ? { errorCode: "virtual_platform_fault", faultCause: "internal_error" }
        : {}),
    };
  }

  parseDlr(payload: unknown): CanonicalDlr {
    const event = payload as Partial<VirtualDlr>;
    const status = event.status;
    if (
      typeof event.providerRef !== "string" ||
      (status !== "delivered" &&
        status !== "undelivered" &&
        status !== "failed") ||
      typeof event.occurredAt !== "string"
    ) {
      throw new Error("Invalid virtual-phone delivery event.");
    }
    return {
      providerRef: event.providerRef,
      status,
      occurredAt: event.occurredAt,
      ...(event.segments ? { segments: event.segments } : {}),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...(event.faultCause ? { faultCause: event.faultCause } : {}),
      raw: payload,
    };
  }

  verifyWebhook(_request: IncomingRequest, _creds: Creds): boolean {
    return false;
  }
}

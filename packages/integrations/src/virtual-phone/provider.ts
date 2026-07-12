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
}

export class VirtualPhoneProvider implements SmsSenderPlugin {
  readonly slug = "virtual-phone";
  readonly capability = "sms" as const;
  readonly version = "1.0.0";
  readonly configSchema = {};
  readonly billableStatuses: readonly MessageStatus[] = ["accepted"];
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
    return {
      providerRef: `virtual-${message.messageId}`,
      status: "delivered",
      occurredAt: new Date().toISOString(),
      segments: message.segments,
    };
  }

  parseDlr(payload: unknown): CanonicalDlr {
    const event = payload as Partial<VirtualDlr>;
    if (
      typeof event.providerRef !== "string" ||
      event.status !== "delivered" ||
      typeof event.occurredAt !== "string"
    ) {
      throw new Error("Invalid virtual-phone delivery event.");
    }
    return {
      providerRef: event.providerRef,
      status: event.status,
      occurredAt: event.occurredAt,
      ...(event.segments ? { segments: event.segments } : {}),
      raw: payload,
    };
  }

  verifyWebhook(_request: IncomingRequest, _creds: Creds): boolean {
    return false;
  }
}

import type { AppDb, PricingSnapshot, TenantTx } from "@app/db";
import type { RateTable } from "@app/domain";
import type { Creds, MessageStatus, SmsSenderPlugin } from "@app/integrations";
import type { ManagedSendContext } from "./managed-send.js";

/**
 * The token entitlement backend (ADR-0010 Phase 2). INJECTED rather than imported, exactly as
 * `rates` is: the count layer lives in the api service, and the engine must not depend on it. Absent
 * = tokens are not wired, and every send is wallet-backed as before.
 */
export interface TokenBackend {
  /**
   * Claim `quantity` tokens (the SEGMENT count for SMS) for this message. `held: false` means the
   * caller falls through to the wallet — never a partial claim.
   */
  hold(
    tx: TenantTx,
    p: {
      channel: "sms";
      currency: string;
      quantity: bigint;
      referenceId: string;
      compatibility?: {
        providerVendor: string;
        destinationCountry?: string;
        trafficClass?: string;
        serviceClass?: string;
      };
    },
  ): Promise<{ held: boolean }>;
  /** Spend (`committed`) or give back (`returned`) the holds for a message. Idempotent. */
  resolve(
    tx: TenantTx,
    referenceId: string,
    outcome: "committed" | "returned",
  ): Promise<unknown>;
}

/** Operational sandbox capacity. It never owns money and has no settlement lifecycle. */
export interface SandboxAllowanceBackend {
  consume(
    tx: TenantTx,
    p: {
      channel: "sms";
      units: bigint;
      referenceId: string;
      applicationId?: string | null;
      environmentId?: string | null;
    },
  ): Promise<void>;
}

export interface EngineDeps {
  db: AppDb;
  provider: SmsSenderPlugin;
  creds?: Creds;
  rates?: RateTable;
  tokens?: TokenBackend;
  sandboxAllowance?: SandboxAllowanceBackend;
}

export interface SendInput {
  tenantId: string;
  messageId?: string;
  applicationId?: string | null;
  environmentId?: string | null;
  to: string;
  senderId: string;
  body: string;
  currency: string;
  subjectId?: string;
  bodyPiiId?: string;
  deliveryMode?: "virtual" | "live";
  /**
   * Immutable live-plane quote resolved before tx1. Virtual sends omit it because their daily
   * allowance never touches pricing or the wallet.
   */
  pricing?: {
    readonly currency: string;
    readonly costMinor: bigint;
    readonly snapshot: PricingSnapshot;
  };
  managed?: ManagedSendContext;
}

export interface PreparedSend {
  messageId: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
  replayed?: boolean;
}

export interface SendResult {
  messageId: string;
  status: MessageStatus;
}

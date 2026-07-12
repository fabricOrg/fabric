import type {
  DeliveryMode,
  MessageDetail,
  MessageSummary,
  SendSmsResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import type {
  Creds,
  SmsSenderPlugin,
  VirtualPhoneProvider,
} from "@app/integrations";
import type { FakeProvider } from "@app/integrations/testing";
import {
  dispatchSend as engineDispatchSend,
  failPreparedSend as engineFailPreparedSend,
  prepareSend as enginePrepareSend,
  sweepExpired as engineSweepExpired,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ConsentService } from "../consent/consent.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { AutoTopupService } from "../payments/auto-topup.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SendersService } from "../senders/senders.service.js";
import { assertSendCompliant } from "./sms-compliance.js";
import { dispatchSend as dispatchProviderSend } from "./sms-dispatch.js";
import { ingestProviderDlr } from "./sms-dlr.js";
import { buildSmsProviders } from "./sms-providers.js";
import { getMessage, listMessages } from "./sms-read.js";
import { SMS_SEND_QUEUE, type SmsSendJob } from "./sms-send.job.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

/**
 * Wires the HTTP boundary to the L5 send pipeline. Holds the EngineDeps (the app_runtime AppDb + the
 * SMS provider + its creds) and exposes send + DLR-ingest. Provider is selected by SMS_PROVIDER:
 * `fake` (default — sandbox/tests) or `arkesel` (real Ghana vendor). The engine + controllers stay
 * provider-agnostic via SmsSenderPlugin. Live SMS is a redline: Arkesel defaults to sandbox mode
 * (ARKESEL_SANDBOX) and every send is gated by the platform.sms_sending kill-switch.
 */
@Injectable()
export class SmsService {
  private readonly provider: SmsSenderPlugin;
  private readonly creds: Creds | undefined;
  // ADR-0002 F3: sandbox tenants are PINNED to the fake provider no matter what SMS_PROVIDER
  // says — a sandbox send must never reach a real carrier. Kept alongside the configured
  // provider so one api serves live and sandbox tenants simultaneously.
  private readonly virtualProvider: VirtualPhoneProvider;
  private readonly legacySandboxProvider: FakeProvider;
  private readonly liveReady: boolean;
  private readonly liveReadinessReason: string | null;
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(AutoTopupService) private readonly autoTopup: AutoTopupService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(SendersService) private readonly senders: SendersService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
    @Inject(PiiVaultService) private readonly piiVault: PiiVaultService,
  ) {
    const wired = buildSmsProviders(this.config, this.logger);
    this.provider = wired.provider;
    this.creds = wired.creds;
    this.virtualProvider = wired.virtualProvider;
    this.legacySandboxProvider = wired.legacySandboxProvider;
    this.liveReady = wired.liveReady;
    this.liveReadinessReason = wired.liveReadinessReason;
  }

  private deps(deliveryMode: DeliveryMode = "live") {
    if (deliveryMode === "virtual") {
      return { db: this.db, provider: this.virtualProvider };
    }
    return {
      db: this.db,
      provider: this.provider,
      ...(this.creds ? { creds: this.creds } : {}),
    };
  }

  /** POST /v1/sms/send — the tenant is already resolved by ApiKeyGuard. */
  async send(input: {
    tenantId: string;
    to: string;
    senderId: string;
    body: string;
    currency: string;
    /** E10-S5: absent = transactional (OTP/receipts). Promotional must be declared. */
    messageClass?: "transactional" | "promotional";
  }): Promise<SendSmsResponse> {
    if (await this.killSwitch.isPaused("platform.sms_sending")) {
      throw invalidRequest(
        "sms_sending_paused",
        "SMS sending is temporarily paused.",
      );
    }
    const deliveryMode = await this.virtualPhone.resolveMode(input.tenantId);
    if (deliveryMode === "live" && !this.liveReady) {
      throw invalidRequest(
        "live_provider_not_ready",
        this.liveReadinessReason ?? "Live SMS is not configured.",
      );
    }
    // (never a silent send, never a faked success) — the honest behavior until a 2nd provider lands.
    if (
      deliveryMode === "live" &&
      (await this.killSwitch.isPaused(`provider.${this.provider.slug}`))
    ) {
      throw invalidRequest(
        "provider_unavailable",
        "The SMS provider is temporarily unavailable. Try again shortly.",
      );
    }
    // E10-S4/S5: compliance gates (sender registration, opt-outs, promo window) — see
    // sms-compliance.ts for the ordering + postures.
    const messageClass = input.messageClass ?? "transactional";
    await assertSendCompliant({
      senders: this.senders,
      consent: this.consent,
      tenantId: input.tenantId,
      to: input.to,
      senderId: input.senderId,
      messageClass,
      virtual: deliveryMode === "virtual",
    });
    // Tokenize the recipient BEFORE the message row exists: `messages` references a subject_id
    // surrogate and never the raw number (COMPLIANCE §5), so the subject must exist first. A send
    // that later fails leaves behind a subject with only their number — harmless, and erasable.
    const subjectId = await this.piiVault.subjectForPhone(
      input.tenantId,
      input.to,
    );
    // tx1 in-request EITHER way: insufficient funds must fail the request synchronously (a queue
    // must never accept money it can't reserve).
    const routedInput: SendInput = { ...input, deliveryMode, subjectId };
    const prepared = await enginePrepareSend(
      this.deps(deliveryMode),
      routedInput,
    );
    if (deliveryMode === "virtual") {
      try {
        await this.virtualPhone.record({
          tenantId: input.tenantId,
          messageId: prepared.messageId,
          subjectId,
          body: input.body,
        });
      } catch (error) {
        await engineFailPreparedSend(
          this.deps(deliveryMode),
          routedInput,
          prepared,
          "virtual_delivery_persistence_failed",
        );
        throw error;
      }
    }

    let status: SendResult["status"];
    if (this.queue.enabled) {
      // Queued path: the provider call + tx2 run in the worker with retry/backoff. jobId =
      // messageId → BullMQ dedupes, so an accidental double-enqueue is a no-op.
      await this.queue
        .queue(SMS_SEND_QUEUE)
        .add(
          "send",
          { input: routedInput, prepared, deliveryMode } satisfies SmsSendJob,
          {
            jobId: prepared.messageId,
            attempts: 5,
            backoff: { type: "exponential", delay: 2_000 },
            removeOnComplete: { count: 1_000 },
            removeOnFail: { count: 5_000 },
          },
        );
      status = "sending"; // truthful: reserved + persisted, provider outcome pending
    } else {
      // Inline fallback (no Redis configured): the pre-queue behavior, unchanged.
      const result = await this.dispatch(routedInput, prepared, deliveryMode);
      status = result.status;
    }

    // After-debit trigger: the send just reserved against the wallet — check whether the balance
    // has fallen to the auto-top-up threshold. Fire-and-forget: never block or fail the send.
    void this.autoTopup.maybeAutoTopUp(input.tenantId).catch((error) => {
      this.logger.error(
        `maybeAutoTopUp failed post-send for ${input.tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    });
    const message = await this.get(input.tenantId, prepared.messageId);
    return {
      id: message.id,
      status,
      encoding: message.encoding,
      segments: message.segments,
      cost: message.cost,
    };
  }

  /**
   * Worker entry for a queued send: provider call + tx2. Throwing propagates to BullMQ, which
   * retries with backoff — safe because dispatchSend is retry-idempotent (terminal-freeze + B6)
   * and the TTL sweeper refunds anything that never resolves.
   */
  async processQueuedSend(job: SmsSendJob): Promise<SendResult> {
    // Route on the flag captured at send time (a plan change mid-flight must not flip provider);
    // pre-F3 jobs without the flag came from live-configured tenants → configured provider.
    if (!job.deliveryMode && job.sandbox === true) {
      return engineDispatchSend(
        { db: this.db, provider: this.legacySandboxProvider },
        job.input,
        job.prepared,
      );
    }
    return this.dispatch(job.input, job.prepared, job.deliveryMode ?? "live");
  }

  private async dispatch(
    input: SendInput,
    prepared: PreparedSend,
    deliveryMode: DeliveryMode,
  ): Promise<SendResult> {
    return dispatchProviderSend({
      deps: this.deps(deliveryMode),
      virtualProvider: this.virtualProvider,
      input,
      prepared,
      deliveryMode,
    });
  }

  /**
   * Reservation sweeper entry for the scheduled maintenance job: resolve this tenant's messages
   * stuck non-terminal past the TTL (crash between reserve and the provider outcome). Runs inside
   * `withTenant` on app_runtime — the engine's resolveMessage decides commit/refund idempotently,
   * so concurrent/repeated sweeps are safe. Returns how many messages were resolved.
   */
  async sweepStuck(tenantId: string, olderThanIso: string): Promise<number> {
    return engineSweepExpired(
      this.deps("live"),
      tenantId,
      olderThanIso,
      (mode) => this.deps(mode),
    );
  }

  async list(tenantId: string): Promise<MessageSummary[]> {
    return listMessages(this.db, tenantId);
  }

  async get(tenantId: string, id: string): Promise<MessageDetail> {
    return getMessage(this.db, tenantId, id);
  }

  /**
   * DLR webhook after the controller's testing ingress-token check. Verify the provider signature
   * over the raw body, resolve the owning tenant possession-scoped by provider_ref (no tenant context
   * yet, no RLS bypass), and ingest inside that tenant. Unknown provider/signature/ref fails closed.
   */
  async ingestDlr(
    providerSlug: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: string }> {
    // F3: sandbox tenants always run on the fake provider, so its DLRs must ingest even when the
    // configured provider is a real vendor — one api serves both planes.
    return ingestProviderDlr({
      db: this.db,
      providerSlug,
      body,
      headers,
      live: this.deps("live"),
      virtual: this.deps("virtual"),
    });
  }
}

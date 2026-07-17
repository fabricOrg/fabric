import type {
  MessageDetail,
  MessageSummary,
  SendSmsResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import {
  failPreparedSend as engineFailPreparedSend,
  prepareSend as enginePrepareSend,
  sweepExpired as engineSweepExpired,
  type ManagedSendContext,
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
import { completeStoredDispatch } from "./sms-dispatch-store.js";
import { ingestProviderDlr } from "./sms-dlr.js";
import { assertLiveRecipientAllowed } from "./sms-live-safety.js";
import { replayManagedSend } from "./sms-managed-replay.js";
import {
  enqueueSmsJob,
  processSmsJob,
  recoverPendingSms,
} from "./sms-queue-operations.js";
import { getMessage, listMessages } from "./sms-read.js";
import { SmsRuntimeService } from "./sms-runtime.service.js";
import type { SmsSendJob } from "./sms-send.job.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly runtime: SmsRuntimeService;

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
    @Inject(SmsRuntimeService) runtime?: SmsRuntimeService,
  ) {
    this.runtime = runtime ?? new SmsRuntimeService(db, config, virtualPhone);
  }

  async send(input: {
    tenantId: string;
    messageId?: string;
    to: string;
    senderId: string;
    body: string;
    currency: string;
    /** E10-S5: absent = transactional (OTP/receipts). Promotional must be declared. */
    messageClass?: "transactional" | "promotional";
    /** ADR-0004: the environment the request arrived on (sk_* keys). Null for the BFF token path. */
    environmentId?: string | null;
    /** Application resolved from the presenting key; null only on the legacy BFF token path. */
    applicationId?: string | null;
    managed?: ManagedSendContext;
  }): Promise<SendSmsResponse> {
    if (await this.killSwitch.isPaused("platform.sms_sending")) {
      throw invalidRequest(
        "sms_sending_paused",
        "SMS sending is temporarily paused.",
      );
    }
    // ADR-0004: route on the request's environment when known (a sandbox env can never reach a
    // carrier); fall back to the tenant/plan-based mode for the BFF token path (no environment yet).
    const deliveryMode = input.environmentId
      ? await this.virtualPhone.resolveModeForEnvironment(
          input.tenantId,
          input.environmentId,
        )
      : await this.virtualPhone.resolveMode(input.tenantId);
    if (deliveryMode === "live" && !this.runtime.liveReady) {
      throw invalidRequest(
        "live_provider_not_ready",
        this.runtime.liveReadinessReason ?? "Live SMS is not configured.",
      );
    }
    assertLiveRecipientAllowed(this.config, deliveryMode, input.to);
    if (
      deliveryMode === "live" &&
      (await this.killSwitch.isPaused(`provider.${this.runtime.provider.slug}`))
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
    const bodyPiiId = await this.piiVault.put(
      input.tenantId,
      subjectId,
      "body",
      input.body,
    );
    // tx1 in-request EITHER way: insufficient funds must fail the request synchronously (a queue
    // must never accept money it can't reserve).
    const routedInput: SendInput = {
      ...input,
      deliveryMode,
      subjectId,
      bodyPiiId,
    };
    const prepared = await enginePrepareSend(
      this.runtime.deps(deliveryMode),
      routedInput,
    );
    if (prepared.replayed && input.managed) {
      return replayManagedSend(this, input.tenantId, prepared.messageId);
    }
    if (deliveryMode === "virtual") {
      try {
        await this.virtualPhone.record({
          tenantId: input.tenantId,
          messageId: prepared.messageId,
          subjectId,
          body: input.body,
          bodyPiiId,
        });
      } catch (error) {
        await engineFailPreparedSend(
          this.runtime.deps(deliveryMode),
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
      try {
        await enqueueSmsJob(this.queue, {
          tenantId: input.tenantId,
          messageId: prepared.messageId,
          deliveryMode,
        });
      } catch (error) {
        // The database dispatch intent is durable and the maintenance trigger will enqueue it
        // again. Returning an accepted message prevents an unsafe client retry from reserving a
        // second message merely because Redis was temporarily unavailable.
        this.logger.error(
          `sms-send enqueue deferred for ${prepared.messageId}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      status = "sending"; // truthful: reserved + persisted, provider outcome pending
    } else {
      const result = await this.runtime.dispatch(
        routedInput,
        prepared,
        deliveryMode,
      );
      status = result.status;
      await completeStoredDispatch(this.db, input.tenantId, prepared.messageId);
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

  /** Worker retries are safe because provider contact and wallet resolution are idempotent. */
  async processQueuedSend(job: SmsSendJob): Promise<SendResult> {
    return processSmsJob({
      db: this.db,
      vault: this.piiVault,
      job,
      dispatch: (input, prepared, mode) =>
        this.runtime.dispatch(input, prepared, mode),
      fail: (input, prepared, mode) =>
        engineFailPreparedSend(
          this.runtime.deps(mode),
          input,
          prepared,
          "dispatch_material_unreadable",
        ),
      legacyDispatch: (input, prepared) =>
        this.runtime.legacyDispatch(input, prepared),
    });
  }

  async enqueuePending(tenantId: string): Promise<number> {
    if (!this.queue.enabled) return 0;
    try {
      return await recoverPendingSms({
        db: this.db,
        queue: this.queue,
        tenantId,
      });
    } catch (error) {
      this.logger.warn(
        `sms-send recovery enqueue deferred for ${tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return 0;
    }
  }

  /**
   * Reservation sweeper entry for the scheduled maintenance job: resolve this tenant's messages
   * stuck non-terminal past the TTL (crash between reserve and the provider outcome). Runs inside
   * `withTenant` on app_runtime — the engine's resolveMessage decides commit/refund idempotently,
   * so concurrent/repeated sweeps are safe. Returns how many messages were resolved.
   */
  async sweepStuck(tenantId: string, olderThanIso: string): Promise<number> {
    return engineSweepExpired(
      this.runtime.deps("live"),
      tenantId,
      olderThanIso,
      (mode) => this.runtime.deps(mode),
    );
  }

  async list(
    tenantId: string,
    environmentId?: string | null,
  ): Promise<MessageSummary[]> {
    return listMessages(this.db, tenantId, environmentId);
  }

  async get(
    tenantId: string,
    id: string,
    environmentId?: string | null,
  ): Promise<MessageDetail> {
    return getMessage(this.db, tenantId, id, environmentId);
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
      live: this.runtime.deps("live"),
      virtual: this.runtime.deps("virtual"),
    });
  }
}

import type { MessageDetail, SendSmsResponse } from "@app/contracts";
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
import type { KeysetCursor } from "../http/cursor.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SendersService } from "../senders/senders.service.js";
import { assertSendCompliant } from "./sms-compliance.js";
import { recheckedDispatch } from "./sms-dispatch-recheck.js";
import { completeStoredDispatch } from "./sms-dispatch-store.js";
import { ingestProviderDlr } from "./sms-dlr.js";
import { assertLiveProviderAvailable } from "./sms-live-gate.js";
import { replayManagedSend } from "./sms-managed-replay.js";
import {
  enqueueSmsJob,
  processSmsJob,
  recoverPendingSmsSafely,
} from "./sms-queue-operations.js";
import {
  getMessage,
  listMessages,
  type MessagePageResult,
} from "./sms-read.js";
import { SmsRuntimeService } from "./sms-runtime.service.js";
import type { SmsSendJob } from "./sms-send.job.js";
import { recordVirtualDeliveryOrFail } from "./sms-virtual-record.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly runtime: SmsRuntimeService;

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    // Not a property: the only remaining consumer is the SmsRuntimeService fallback constructed
    // below. The live-recipient pin that used to read it here was removed 2026-07-28.
    @Inject(ConfigService) config: ConfigService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(SendersService) private readonly senders: SendersService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(VirtualPhoneService)
    private readonly virtualPhone: VirtualPhoneService,
    @Inject(PiiVaultService) private readonly piiVault: PiiVaultService,
    @Inject(PricingService) private readonly pricing: PricingService,
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
    // ADR-0011: readiness AND provider identity now come from the control plane, so both are async.
    await assertLiveProviderAvailable({
      runtime: this.runtime,
      killSwitch: this.killSwitch,
      deliveryMode,
    });
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
    // Price against the account's book (ADR-0010). resolveRates never throws — a pricing-store
    // outage serves last-known-good/compiled defaults; the wallet reserve below still fails closed.
    const rates = await this.pricing.resolveRates(input.tenantId);
    const prepared = await enginePrepareSend(
      await this.runtime.deps(deliveryMode, rates.sms),
      routedInput,
    );
    if (prepared.replayed && input.managed) {
      return replayManagedSend(this, input.tenantId, prepared.messageId);
    }
    if (deliveryMode === "virtual") {
      await recordVirtualDeliveryOrFail({
        virtualPhone: this.virtualPhone,
        deps: await this.runtime.deps(deliveryMode),
        tenantId: input.tenantId,
        body: input.body,
        subjectId,
        bodyPiiId,
        prepared,
        routedInput,
      });
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
      dispatch: recheckedDispatch({
        killSwitch: this.killSwitch,
        consent: this.consent,
        senders: this.senders,
        runtime: this.runtime,
      }),
      fail: async (input, prepared, mode) =>
        engineFailPreparedSend(
          await this.runtime.deps(mode),
          input,
          prepared,
          "dispatch_material_unreadable",
        ),
      legacyDispatch: (input, prepared) =>
        this.runtime.legacyDispatch(input, prepared),
    });
  }

  async enqueuePending(tenantId: string): Promise<number> {
    return recoverPendingSmsSafely({
      db: this.db,
      queue: this.queue,
      tenantId,
      warn: (message) => this.logger.warn(message),
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
      await this.runtime.deps("live"),
      tenantId,
      olderThanIso,
    );
  }

  async list(
    tenantId: string,
    environmentId: string | null | undefined,
    page: { limit: number; before?: KeysetCursor },
  ): Promise<MessagePageResult> {
    return listMessages(this.db, tenantId, environmentId, page);
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
      live: await this.runtime.deps("live"),
      virtual: await this.runtime.deps("virtual"),
    });
  }
}

import type {
  WhatsappMessage,
  WhatsappMessageListResponse,
  WhatsappSendRequest,
  WhatsappSendResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { MetaCloudError } from "@app/integrations";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConsentService } from "../consent/consent.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import type { PageInput } from "../http/cursor.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { assertWhatsappCompliant } from "./whatsapp-compliance.js";
import { resolveWhatsappEnvironment } from "./whatsapp-environment.js";
import {
  claimStoredWhatsapp,
  pendingWhatsappDispatches,
  recordUnknownWhatsappDispatchOutcome,
} from "./whatsapp-load.js";
import { prepareWhatsapp } from "./whatsapp-prepare.js";
import { getWhatsappMessage, listWhatsappMessages } from "./whatsapp-reads.js";
import { resolveWhatsappStatus } from "./whatsapp-resolve.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import {
  WHATSAPP_SEND_QUEUE,
  type WhatsappSendJob,
} from "./whatsapp-send.job.js";
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly sandboxAllowance: SandboxAllowanceService;

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(WhatsappRuntimeService)
    private readonly runtime: WhatsappRuntimeService,
    @Optional()
    @Inject(SandboxAllowanceService)
    sandboxAllowance?: SandboxAllowanceService,
    @Optional()
    @Inject(EffectivePricingService)
    private readonly effectivePricing?: EffectivePricingService,
  ) {
    this.sandboxAllowance = sandboxAllowance ?? new SandboxAllowanceService();
  }

  async send(
    context: {
      tenantId: string;
      applicationId: string;
      environmentId: string;
    },
    input: WhatsappSendRequest,
  ): Promise<WhatsappSendResponse> {
    await this.assertSendingEnabled(context.tenantId);
    const mode = await resolveWhatsappEnvironment(this.db, context);
    const resolved = await this.runtime.resolve(mode);
    if (
      mode === "live" &&
      (await this.killSwitch.isPaused(
        `provider.${resolved.provider.slug}`,
        context.tenantId,
      ))
    ) {
      throw invalidRequest(
        "provider_unavailable",
        "The WhatsApp provider is temporarily unavailable. Try again shortly.",
      );
    }
    await assertWhatsappCompliant({
      consent: this.consent,
      tenantId: context.tenantId,
      to: input.to,
      category: input.template_category,
    });
    const messageId = await prepareWhatsapp({
      db: this.db,
      vault: this.vault,
      sandboxAllowance: this.sandboxAllowance,
      runtime: this.runtime,
      ...(this.effectivePricing
        ? { effectivePricing: this.effectivePricing }
        : {}),
      context,
      content: input,
    });
    if (this.queue.enabled) {
      await this.enqueue(context.tenantId, messageId).catch(
        (error: unknown) => {
          this.logger.warn(
            `whatsapp-send enqueue deferred for ${messageId}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        },
      );
    } else {
      await this.process({ tenantId: context.tenantId, messageId });
    }
    const message = await this.get(
      context.tenantId,
      context.environmentId,
      messageId,
    );
    return { ...message, request_id: newRequestId() };
  }

  async process(job: WhatsappSendJob): Promise<WhatsappSendResponse["status"]> {
    const stored = await claimStoredWhatsapp(
      this.db,
      this.vault,
      job.tenantId,
      job.messageId,
    );
    if (stored.kind === "skip") return stored.status;
    if (stored.kind === "unreadable") {
      return resolveWhatsappStatus(this.db, this.runtime, {
        tenantId: job.tenantId,
        messageRef: job.messageId,
        status: "failed",
        errorCode: "dispatch_material_unreadable",
      });
    }
    const mode = stored.backing === "sandbox_allowance" ? "sandbox" : "live";
    const paused = await this.dispatchBlockReason(job.tenantId, mode);
    if (paused) {
      return resolveWhatsappStatus(this.db, this.runtime, {
        tenantId: job.tenantId,
        messageRef: job.messageId,
        status: "failed",
        errorCode: paused,
      });
    }
    const resolved = await this.runtime.resolve(mode);
    if (resolved.provider.slug !== stored.providerSlug) {
      return resolveWhatsappStatus(this.db, this.runtime, {
        tenantId: job.tenantId,
        messageRef: job.messageId,
        status: "failed",
        errorCode: "whatsapp_provider_selection_changed",
      });
    }
    try {
      const result = await resolved.provider.send(
        {
          messageId: job.messageId,
          to: stored.content.to,
          templateName: stored.content.template_name,
          templateLanguage: stored.content.template_language,
          templateCategory: stored.content.template_category,
          variables: stored.content.variables,
        },
        resolved.creds,
      );
      return resolveWhatsappStatus(this.db, this.runtime, {
        tenantId: job.tenantId,
        messageRef: job.messageId,
        status: result.status,
        ...(result.providerRef ? { providerRef: result.providerRef } : {}),
      });
    } catch (error) {
      if (error instanceof MetaCloudError) {
        return resolveWhatsappStatus(this.db, this.runtime, {
          tenantId: job.tenantId,
          messageRef: job.messageId,
          status: "failed",
          errorCode: error.code,
        });
      }
      await recordUnknownWhatsappDispatchOutcome(
        this.db,
        job.tenantId,
        job.messageId,
        error instanceof Error ? error.message : "unknown_provider_outcome",
      );
      throw error;
    }
  }

  async list(
    tenantId: string,
    environmentId: string,
    page: PageInput,
  ): Promise<Omit<WhatsappMessageListResponse, "request_id">> {
    return listWhatsappMessages(
      this.db,
      this.vault,
      tenantId,
      environmentId,
      page,
    );
  }

  async get(
    tenantId: string,
    environmentId: string,
    messageId: string,
  ): Promise<WhatsappMessage> {
    return getWhatsappMessage(
      this.db,
      this.vault,
      tenantId,
      environmentId,
      messageId,
    );
  }

  async enqueuePending(tenantId: string): Promise<number> {
    if (!this.queue.enabled) return 0;
    const messageIds = await pendingWhatsappDispatches(this.db, tenantId);
    for (const messageId of messageIds) await this.enqueue(tenantId, messageId);
    return messageIds.length;
  }

  private async assertSendingEnabled(tenantId: string): Promise<void> {
    if (await this.killSwitch.isPaused("platform.whatsapp_sending", tenantId)) {
      throw invalidRequest(
        "whatsapp_sending_paused",
        "WhatsApp sending is temporarily paused.",
      );
    }
  }

  private async dispatchBlockReason(
    tenantId: string,
    mode: "sandbox" | "live",
  ): Promise<string | null> {
    if (await this.killSwitch.isPaused("platform.whatsapp_sending", tenantId)) {
      return "whatsapp_sending_paused";
    }
    if (mode === "live") {
      const resolved = await this.runtime.resolve("live");
      if (
        await this.killSwitch.isPaused(
          `provider.${resolved.provider.slug}`,
          tenantId,
        )
      ) {
        return "provider_unavailable";
      }
    }
    return null;
  }

  private async enqueue(tenantId: string, messageId: string): Promise<void> {
    await this.queue
      .queue(WHATSAPP_SEND_QUEUE)
      .add("send", { tenantId, messageId } satisfies WhatsappSendJob, {
        jobId: messageId,
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: true,
      });
  }
}

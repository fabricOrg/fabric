import type {
  WhatsappMessage,
  WhatsappMessageListResponse,
  WhatsappSendRequest,
  WhatsappSendResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { MetaCloudError, STATUS_RANK } from "@app/integrations";
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
import { loadStoredWhatsapp } from "./whatsapp-load.js";
import { prepareWhatsapp } from "./whatsapp-prepare.js";
import { getWhatsappMessage, listWhatsappMessages } from "./whatsapp-reads.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import {
  WHATSAPP_SEND_QUEUE,
  type WhatsappSendJob,
} from "./whatsapp-send.job.js";
import {
  isTerminalWhatsappStatus,
  parseWhatsappBacking,
  settleWhatsappBacking,
} from "./whatsapp-settlement.js";

type Row = Record<string, unknown>;

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
    const stored = await loadStoredWhatsapp(
      this.db,
      this.vault,
      job.tenantId,
      job.messageId,
    );
    if (stored.kind === "skip") return stored.status;
    if (stored.kind === "unreadable") {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: "dispatch_material_unreadable",
      });
    }
    const mode = stored.backing === "sandbox_allowance" ? "sandbox" : "live";
    const paused = await this.dispatchBlockReason(job.tenantId, mode);
    if (paused) {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: paused,
      });
    }
    const resolved = await this.runtime.resolve(mode);
    if (resolved.provider.slug !== stored.providerSlug) {
      return this.resolve(job.tenantId, job.messageId, "failed", {
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
      return this.resolve(job.tenantId, job.messageId, result.status, {
        ...(result.providerRef ? { providerRef: result.providerRef } : {}),
      });
    } catch (error) {
      if (error instanceof MetaCloudError) {
        return this.resolve(job.tenantId, job.messageId, "failed", {
          errorCode: error.code,
        });
      }
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
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT message_id FROM whatsapp_dispatches
        WHERE completed_at IS NULL AND available_at <= now()
        ORDER BY available_at, message_id LIMIT 100`,
    )) as Row[];
    for (const row of rows)
      await this.enqueue(tenantId, String(row.message_id));
    return rows.length;
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

  private async resolve(
    tenantId: string,
    messageId: string,
    status: WhatsappSendResponse["status"],
    detail: { providerRef?: string; errorCode?: string },
  ): Promise<WhatsappSendResponse["status"]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        SELECT status::text, status_rank, backing, application_id, environment_id
        FROM whatsapp_messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
      const current = rows[0];
      if (!current) return "failed";
      const prior = String(current.status) as WhatsappSendResponse["status"];
      if (isTerminalWhatsappStatus(prior)) return prior;
      await settleWhatsappBacking(tx, {
        backing: parseWhatsappBacking(String(current.backing)),
        priorRank: Number(current.status_rank),
        nextStatus: status,
        messageId,
      });
      await tx`
        UPDATE whatsapp_messages SET status = ${status}, status_rank = ${STATUS_RANK[status]},
          provider_ref = COALESCE(${detail.providerRef ?? null}, provider_ref),
          error_code = COALESCE(${detail.errorCode ?? null}, error_code), updated_at = now()
        WHERE id = ${messageId}`;
      await tx`
        UPDATE whatsapp_dispatches SET completed_at = now(), updated_at = now()
        WHERE message_id = ${messageId}`;
      await tx`
        INSERT INTO outbox_events (
          tenant_id, application_id, environment_id, event_type, payload
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${String(current.application_id)},
          ${String(current.environment_id)}, 'message.updated',
          ${JSON.stringify({ message_id: messageId, channel: "whatsapp", status, previous_status: prior })}::jsonb
        )`;
      return status;
    });
  }
}

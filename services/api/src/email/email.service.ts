import type {
  EmailMessage,
  SendEmailApiResponse,
  SendEmailRequest,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import { FakeEmailProvider } from "@app/integrations/testing/email";
import { commit, refund } from "@app/wallet";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import type { PageInput } from "../http/cursor.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { EffectivePricingService } from "../pricing/effective-pricing.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SandboxAllowanceService } from "../sandbox-allowance/sandbox-allowance.service.js";
import { isTerminalEmailStatus } from "./email-content.js";
import {
  emailDispatchBlockReason,
  sweepManagedEmailExpired,
} from "./email-dispatch-recovery.js";
import { loadStoredEmail } from "./email-load.js";
import type { ManagedEmailAcceptInput } from "./email-managed-accept.js";
import { prepareManagedEmail } from "./email-managed-prepare.js";
import { reconcileManagedEmailTerminal } from "./email-managed-resolve.js";
import { prepareEmail } from "./email-prepare.js";
import { type EmailPageResult, getEmail, listEmails } from "./email-reads.js";
import { EmailRuntimeService } from "./email-runtime.service.js";
import { EMAIL_SEND_QUEUE, type EmailSendJob } from "./email-send.job.js";
import { ingestSesEvent } from "./ses-event-ingest.js";

type Row = Record<string, unknown>;

@Injectable()
export class EmailService {
  private readonly provider = new FakeEmailProvider();
  private readonly logger = new Logger(EmailService.name);
  private readonly sandboxAllowance: SandboxAllowanceService;

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Optional()
    @Inject(SandboxAllowanceService)
    sandboxAllowance?: SandboxAllowanceService,
    @Optional()
    @Inject(EmailRuntimeService)
    private readonly runtime?: EmailRuntimeService,
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
    input: SendEmailRequest,
  ): Promise<SendEmailApiResponse> {
    if (await this.killSwitch.isPaused("platform.email_sending")) {
      throw invalidRequest(
        "email_sending_paused",
        "Email sending is temporarily paused.",
      );
    }
    const messageId = await prepareEmail({
      db: this.db,
      vault: this.vault,
      sandboxAllowance: this.sandboxAllowance,
      sandboxProvider: this.provider,
      context,
      content: input,
      ...(this.runtime ? { runtime: this.runtime } : {}),
      ...(this.effectivePricing
        ? { effectivePricing: this.effectivePricing }
        : {}),
    });

    let status: SendEmailApiResponse["status"] = "queued";
    if (this.queue.enabled) {
      await this.enqueue(context.tenantId, messageId).catch(
        (error: unknown) => {
          this.logger.warn(
            `email-send enqueue deferred for ${messageId}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        },
      );
    } else {
      status = await this.process({ tenantId: context.tenantId, messageId });
    }
    return { id: messageId, status, request_id: newRequestId() };
  }

  async acceptManaged(input: ManagedEmailAcceptInput): Promise<void> {
    if (await this.killSwitch.isPaused("platform.email_sending")) {
      throw invalidRequest(
        "email_sending_paused",
        "Email sending is temporarily paused.",
      );
    }
    await prepareManagedEmail({
      db: this.db,
      vault: this.vault,
      sandboxAllowance: this.sandboxAllowance,
      sandboxProvider: this.provider,
      message: input,
      ...(this.runtime ? { runtime: this.runtime } : {}),
      ...(this.effectivePricing
        ? { effectivePricing: this.effectivePricing }
        : {}),
    });
  }

  async process(job: EmailSendJob): Promise<SendEmailApiResponse["status"]> {
    const stored = await loadStoredEmail(
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
    const blocked = await emailDispatchBlockReason(this.killSwitch);
    if (blocked) {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: blocked,
      });
    }
    const mode = stored.backing === "sandbox_allowance" ? "sandbox" : "live";
    const runtime =
      this.runtime ??
      (mode === "sandbox"
        ? { resolve: async () => ({ provider: this.provider, creds: {} }) }
        : undefined);
    if (!runtime) {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: "live_email_not_configured",
      });
    }
    const resolved = await runtime.resolve(mode);
    if (resolved.provider.slug !== stored.providerSlug) {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: "email_provider_selection_changed",
      });
    }
    const result = await resolved.provider.send(
      {
        messageId: job.messageId,
        to: stored.content.to,
        from: stored.content.from,
        subject: stored.content.subject,
        ...(stored.content.text ? { text: stored.content.text } : {}),
        ...(stored.content.html ? { html: stored.content.html } : {}),
        ...(stored.content.reply_to
          ? { replyTo: stored.content.reply_to }
          : {}),
      },
      resolved.creds,
    );
    return this.resolve(job.tenantId, job.messageId, result.status, {
      providerRef: result.providerRef,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    });
  }

  async list(
    tenantId: string,
    environmentId: string,
    page: PageInput,
  ): Promise<EmailPageResult> {
    return listEmails(this.db, this.vault, tenantId, environmentId, page);
  }

  async get(
    tenantId: string,
    environmentId: string,
    messageId: string,
  ): Promise<EmailMessage> {
    return getEmail(this.db, this.vault, tenantId, environmentId, messageId);
  }

  async enqueuePending(tenantId: string): Promise<number> {
    if (!this.queue.enabled) return 0;
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT message_id FROM email_dispatches
        WHERE completed_at IS NULL AND available_at <= now()
        ORDER BY available_at, message_id LIMIT 100`,
    )) as Row[];
    for (const row of rows)
      await this.enqueue(tenantId, String(row.message_id));
    return rows.length;
  }

  async sweepStuck(tenantId: string, olderThanIso: string): Promise<number> {
    return sweepManagedEmailExpired(
      this.db,
      tenantId,
      olderThanIso,
      (scopedTenantId, messageId, status, detail) =>
        this.resolve(scopedTenantId, messageId, status, detail),
    );
  }

  async ingestSesEvent(body: unknown): Promise<{ status: string }> {
    return ingestSesEvent({
      db: this.db,
      runtime: this.runtime,
      body,
      resolve: (tenantId, messageId, status, detail) =>
        this.resolve(tenantId, messageId, status, detail),
    });
  }

  private async enqueue(tenantId: string, messageId: string): Promise<void> {
    await this.queue
      .queue(EMAIL_SEND_QUEUE)
      .add("send", { tenantId, messageId } satisfies EmailSendJob, {
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
    status: SendEmailApiResponse["status"],
    detail: { providerRef?: string; errorCode?: string },
  ): Promise<SendEmailApiResponse["status"]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        SELECT status::text, status_rank, backing, application_id, environment_id
        FROM email_messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
      const current = rows[0];
      if (!current) return "failed";
      const prior = String(current.status) as SendEmailApiResponse["status"];
      if (isTerminalEmailStatus(prior)) return prior;
      if (String(current.backing) === "wallet") {
        const reachedBillable =
          Number(current.status_rank) >= STATUS_RANK.accepted ||
          STATUS_RANK[status] >= STATUS_RANK.accepted;
        if (reachedBillable) {
          await commit(tx, {
            referenceId: messageId,
            idempotencyKey: `commit:${messageId}`,
          });
        } else if (isTerminalEmailStatus(status)) {
          await refund(tx, {
            referenceId: messageId,
            idempotencyKey: `refund:${messageId}`,
          });
        }
      }
      await tx`
        UPDATE email_messages SET status = ${status}, status_rank = ${STATUS_RANK[status]},
          provider_ref = COALESCE(${detail.providerRef ?? null}, provider_ref),
          error_code = COALESCE(${detail.errorCode ?? null}, error_code), updated_at = now()
        WHERE id = ${messageId}`;
      await tx`
        UPDATE email_dispatches SET completed_at = now(), updated_at = now()
        WHERE message_id = ${messageId}`;
      await tx`
        INSERT INTO outbox_events (
          tenant_id, application_id, environment_id, event_type, payload
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${String(current.application_id)},
          ${String(current.environment_id)}, 'message.updated',
          ${JSON.stringify({ message_id: messageId, channel: "email", status, previous_status: prior })}::jsonb
        )`;
      await reconcileManagedEmailTerminal(tx, {
        messageId,
        newStatus: status,
        ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
      });
      return status;
    });
  }
}

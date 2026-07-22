import type {
  EmailMessage,
  SendEmailApiResponse,
  SendEmailRequest,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import { FakeEmailProvider } from "@app/integrations/testing/email";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, newRequestId, notFound } from "../http/api-error.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  hydrateEmailRows,
  isTerminalEmailStatus,
  parseEmailContent,
} from "./email-content.js";
import {
  acceptManagedEmail,
  type ManagedEmailAcceptInput,
} from "./email-managed-accept.js";
import { reconcileManagedEmailTerminal } from "./email-managed-resolve.js";
import { EMAIL_SEND_QUEUE, type EmailSendJob } from "./email-send.job.js";

type Row = Record<string, unknown>;

@Injectable()
export class EmailService {
  private readonly provider = new FakeEmailProvider();

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
  ) {}

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
    await this.assertSandboxEnvironment(context);
    const subjectId = await this.vault.subjectForEmail(
      context.tenantId,
      input.to,
    );
    const contentPiiId = await this.vault.put(
      context.tenantId,
      subjectId,
      "body",
      JSON.stringify(input),
    );
    const messageId = await this.db.withTenant(context.tenantId, async (tx) => {
      const rows = (await tx`
        INSERT INTO email_messages (
          tenant_id, application_id, environment_id, subject_id, content_pii_id,
          status, status_rank, provider_slug
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${context.applicationId},
          ${context.environmentId}, ${subjectId}, ${contentPiiId}, 'queued',
          ${STATUS_RANK.queued}, ${this.provider.slug}
        ) RETURNING id`) as Row[];
      const id = String(rows[0]?.id);
      await tx`
        INSERT INTO email_dispatches (message_id, tenant_id)
        VALUES (${id}, current_setting('app.tenant_id')::uuid)`;
      await tx`
        INSERT INTO outbox_events (
          tenant_id, application_id, environment_id, event_type, payload
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${context.applicationId},
          ${context.environmentId}, 'message.created',
          ${JSON.stringify({ message_id: id, channel: "email", status: "queued" })}::jsonb
        )`;
      return id;
    });

    let status: SendEmailApiResponse["status"] = "queued";
    if (this.queue.enabled) {
      await this.enqueue(context.tenantId, messageId).catch(() => undefined);
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
    await acceptManagedEmail(
      {
        db: this.db,
        vault: this.vault,
        providerSlug: this.provider.slug,
        assertSandbox: (context) => this.assertSandboxEnvironment(context),
      },
      input,
    );
  }

  async process(job: EmailSendJob): Promise<SendEmailApiResponse["status"]> {
    const stored = await this.load(job.tenantId, job.messageId);
    if (stored.kind === "skip") return stored.status;
    if (stored.kind === "unreadable") {
      return this.resolve(job.tenantId, job.messageId, "failed", {
        errorCode: "dispatch_material_unreadable",
      });
    }
    const result = await this.provider.send(
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
      {},
    );
    return this.resolve(job.tenantId, job.messageId, result.status, {
      providerRef: result.providerRef,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    });
  }

  async list(tenantId: string, environmentId: string): Promise<EmailMessage[]> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT id, subject_id, content_pii_id, status::text, provider_slug,
               error_code, created_at
        FROM email_messages
        WHERE environment_id = ${environmentId}
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
    )) as Row[];
    return hydrateEmailRows(this.vault, tenantId, rows);
  }

  async get(
    tenantId: string,
    environmentId: string,
    messageId: string,
  ): Promise<EmailMessage> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT id, subject_id, content_pii_id, status::text, provider_slug,
               error_code, created_at
        FROM email_messages
        WHERE id = ${messageId} AND environment_id = ${environmentId}
        LIMIT 1`,
    )) as Row[];
    if (!rows[0]) throw notFound("email_not_found", "Email message not found.");
    const hydrated = await hydrateEmailRows(this.vault, tenantId, rows);
    const message = hydrated[0];
    if (!message) throw notFound("email_not_found", "Email message not found.");
    return message;
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

  private async assertSandboxEnvironment(context: {
    tenantId: string;
    applicationId: string;
    environmentId: string;
  }): Promise<void> {
    const rows = (await this.db.withTenant(
      context.tenantId,
      (tx) => tx`
        SELECT type::text, status::text FROM environments
        WHERE id = ${context.environmentId}
          AND application_id = ${context.applicationId}
        LIMIT 1`,
    )) as Row[];
    const environment = rows[0];
    if (!environment || environment.status !== "active") {
      throw invalidRequest(
        "environment_unavailable",
        "The API key environment is unavailable.",
      );
    }
    if (environment.type !== "sandbox") {
      throw invalidRequest(
        "live_email_not_configured",
        "Live Email requires an approved sending domain and configured provider.",
      );
    }
  }
  private async load(
    tenantId: string,
    messageId: string,
  ): Promise<
    | { kind: "skip"; status: SendEmailApiResponse["status"] }
    | { kind: "unreadable" }
    | { kind: "ready"; content: SendEmailRequest }
  > {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT m.status::text, m.content_pii_id, d.completed_at
        FROM email_messages m JOIN email_dispatches d ON d.message_id = m.id
        WHERE m.id = ${messageId} LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row) return { kind: "skip", status: "failed" };
    const status = String(row.status) as SendEmailApiResponse["status"];
    if (row.completed_at || isTerminalEmailStatus(status)) {
      return { kind: "skip", status };
    }
    const raw = row.content_pii_id
      ? await this.vault.read(tenantId, String(row.content_pii_id))
      : null;
    if (!raw) return { kind: "unreadable" };
    const content = parseEmailContent(raw);
    return content ? { kind: "ready", content } : { kind: "unreadable" };
  }

  private async resolve(
    tenantId: string,
    messageId: string,
    status: SendEmailApiResponse["status"],
    detail: { providerRef?: string; errorCode?: string },
  ): Promise<SendEmailApiResponse["status"]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const rows = (await tx`
        SELECT status::text, application_id, environment_id
        FROM email_messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
      const current = rows[0];
      if (!current) return "failed";
      const prior = String(current.status) as SendEmailApiResponse["status"];
      if (isTerminalEmailStatus(prior)) return prior;
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

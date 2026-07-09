import {
  currency,
  type MessageDetail,
  type MessageStatus,
  type MessageSummary,
  type SendSmsResponse,
} from "@app/contracts";
import { type AppDb, findCustomerMessage, listCustomerMessages } from "@app/db";
import type { Creds, SmsSenderPlugin } from "@app/integrations";
import { ArkeselSmsProvider } from "@app/integrations";
import { FakeProvider } from "@app/integrations/testing";
import {
  dispatchSend as engineDispatchSend,
  ingestDlr as engineIngestDlr,
  prepareSend as enginePrepareSend,
  sweepExpired as engineSweepExpired,
  type PreparedSend,
  type SendInput,
  type SendResult,
} from "@app/sms-engine";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound, unauthorized } from "../http/api-error.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { AutoTopupService } from "../payments/auto-topup.service.js";
import { QueueService } from "../queue/queue.service.js";

/**
 * The sms-send job payload: everything dispatch needs (tx1 already ran). Carries transient PII by
 * design — jobs are trimmed on completion; Redis is transport, never storage.
 */
export interface SmsSendJob {
  input: SendInput;
  prepared: PreparedSend;
}

export const SMS_SEND_QUEUE = "sms-send";

interface Row {
  tenant_id?: unknown;
  [key: string]: unknown;
}

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
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(AutoTopupService) private readonly autoTopup: AutoTopupService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {
    if (this.config.get<string>("SMS_PROVIDER") === "arkesel") {
      this.provider = new ArkeselSmsProvider();
      // Sandbox by default — real delivery needs ARKESEL_SANDBOX=false, a deliberate human-gated flip.
      const callbackUrl = this.dlrCallbackUrl();
      this.creds = {
        apiKey: this.config.get<string>("ARKESEL_API_KEY") ?? "",
        senderId: this.config.get<string>("ARKESEL_SENDER_ID") ?? "",
        sandbox: this.config.get<string>("ARKESEL_SANDBOX") ?? "true",
        ...(callbackUrl ? { callbackUrl } : {}),
      };
      this.logger.log(
        `SMS provider: arkesel-sms (sandbox=${this.creds.sandbox}, dlr=${callbackUrl ? "on" : "off"})`,
      );
    } else {
      this.provider = new FakeProvider();
    }
  }

  /**
   * Build the Arkesel DLR callback URL from its base + the ingress token. Arkesel's callback is a
   * header-less GET, so the WebhookTokenGuard reads the token from `?token=`; we append it here so the
   * secret lives in ONE place (WEBHOOK_INGRESS_TOKEN) rather than being duplicated into the base URL.
   */
  private dlrCallbackUrl(): string | undefined {
    const base = this.config.get<string>("ARKESEL_DLR_CALLBACK_URL");
    if (!base) return undefined;
    const token = this.config.get<string>("WEBHOOK_INGRESS_TOKEN");
    if (!token) return base;
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }

  private deps() {
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
  }): Promise<SendSmsResponse> {
    // Global kill-switch: staff can halt ALL sending (incident, abuse, vendor outage) in one flip.
    if (await this.killSwitch.isPaused("platform.sms_sending")) {
      throw invalidRequest(
        "sms_sending_paused",
        "SMS sending is temporarily paused.",
      );
    }
    // Per-provider kill-switch (finding 9): halt the ACTIVE provider without pausing the platform.
    // With a single real provider there's no failover target, so a paused provider fails CLOSED
    // (never a silent send, never a faked success) — the honest behavior until a 2nd provider lands.
    // The sandbox `fake-sms` provider has no switch. Gate here at send entry so we don't reserve +
    // enqueue for a provider that can't run.
    if (await this.killSwitch.isPaused(`provider.${this.provider.slug}`)) {
      throw invalidRequest(
        "provider_unavailable",
        "The SMS provider is temporarily unavailable. Try again shortly.",
      );
    }
    // tx1 in-request EITHER way: insufficient funds must fail the request synchronously (a queue
    // must never accept money it can't reserve).
    const prepared = await enginePrepareSend(this.deps(), input);

    let status: SendResult["status"];
    if (this.queue.enabled) {
      // Queued path: the provider call + tx2 run in the worker with retry/backoff. jobId =
      // messageId → BullMQ dedupes, so an accidental double-enqueue is a no-op.
      await this.queue
        .queue(SMS_SEND_QUEUE)
        .add("send", { input, prepared } satisfies SmsSendJob, {
          jobId: prepared.messageId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 5_000 },
        });
      status = "sending"; // truthful: reserved + persisted, provider outcome pending
    } else {
      // Inline fallback (no Redis configured): the pre-queue behavior, unchanged.
      const result = await engineDispatchSend(this.deps(), input, prepared);
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
    return engineDispatchSend(this.deps(), job.input, job.prepared);
  }

  /**
   * Reservation sweeper entry for the scheduled maintenance job: resolve this tenant's messages
   * stuck non-terminal past the TTL (crash between reserve and the provider outcome). Runs inside
   * `withTenant` on app_runtime — the engine's resolveMessage decides commit/refund idempotently,
   * so concurrent/repeated sweeps are safe. Returns how many messages were resolved.
   */
  async sweepStuck(tenantId: string, olderThanIso: string): Promise<number> {
    return engineSweepExpired(this.deps(), tenantId, olderThanIso);
  }

  async list(tenantId: string): Promise<MessageSummary[]> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const rows = await listCustomerMessages(tx);
      return rows.map(toMessageSummary);
    });
  }

  async get(tenantId: string, id: string): Promise<MessageDetail> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const row = await findCustomerMessage(tx, id);
      if (!row) {
        throw notFound("message_not_found", "No message exists with that id.");
      }
      const summary = toMessageSummary(row);
      return {
        ...summary,
        senderId: row.senderId,
        redacted: true,
        timeline: [
          {
            status: summary.status,
            at: row.updatedAt.toISOString(),
          },
        ],
        ...(row.errorCode ? { failureReason: row.errorCode } : {}),
      };
    });
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
    if (providerSlug !== this.provider.slug) {
      throw notFound("unknown_provider", `no provider '${providerSlug}'`);
    }
    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const flatHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      flatHeaders[k] = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
    }
    if (!this.provider.verifyWebhook({ headers: flatHeaders, rawBody }, {})) {
      throw unauthorized("invalid_signature", "DLR webhook signature invalid.");
    }
    const dlr = this.provider.parseDlr(body);
    // Possession-scoped resolve: the dlr_provider_ref_lookup policy exposes only the presented ref's row.
    const tenantId = await this.db.withProviderRefLookup(
      dlr.providerRef,
      async (tx) => {
        const rows = (await tx`
          SELECT tenant_id FROM messages
          WHERE provider_slug = ${providerSlug} AND provider_ref = ${dlr.providerRef}`) as Row[];
        return rows[0]?.tenant_id ? String(rows[0].tenant_id) : null;
      },
    );
    if (tenantId === null) {
      throw notFound(
        "message_not_found",
        `no message for provider_ref ${dlr.providerRef}`,
      );
    }
    return { status: await engineIngestDlr(this.deps(), tenantId, body) };
  }
}

function toMessageSummary(row: {
  id: string;
  status: MessageStatus;
  encoding: "gsm7" | "ucs2";
  segments: number;
  costMinor: bigint;
  currency: string;
  providerSlug: string | null;
  subjectId: string | null;
  createdAt: Date;
}): MessageSummary {
  return {
    id: row.id,
    to: row.subjectId ? "Protected recipient" : "Recipient hidden",
    status: row.status,
    encoding: row.encoding,
    segments: row.segments,
    cost: {
      currency: currency.parse(row.currency),
      minor: row.costMinor.toString(),
    },
    provider: row.providerSlug ?? "pending",
    createdAt: row.createdAt.toISOString(),
  };
}

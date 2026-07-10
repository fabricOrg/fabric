import type {
  MessageDetail,
  MessageSummary,
  SendSmsResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import type { Creds, SmsSenderPlugin } from "@app/integrations";
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
import { SendersService } from "../senders/senders.service.js";
import { buildSmsProviders } from "./sms-providers.js";
import { getMessage, listMessages } from "./sms-read.js";

/**
 * The sms-send job payload: everything dispatch needs (tx1 already ran). Carries transient PII by
 * design — jobs are trimmed on completion; Redis is transport, never storage.
 */
export interface SmsSendJob {
  input: SendInput;
  prepared: PreparedSend;
  /** ADR-0002 F3: the worker must dispatch on the SAME provider the send was routed to. */
  sandbox?: boolean;
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
  // ADR-0002 F3: sandbox tenants are PINNED to the fake provider no matter what SMS_PROVIDER
  // says — a sandbox send must never reach a real carrier. Kept alongside the configured
  // provider so one api serves live and sandbox tenants simultaneously.
  private readonly sandboxProvider: SmsSenderPlugin;
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(AutoTopupService) private readonly autoTopup: AutoTopupService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(SendersService) private readonly senders: SendersService,
  ) {
    const wired = buildSmsProviders(this.config, this.logger);
    this.provider = wired.provider;
    this.creds = wired.creds;
    this.sandboxProvider = wired.sandboxProvider;
  }

  private deps(sandbox = false) {
    if (sandbox) {
      // Fake provider needs no creds; passing the real ones would be wrong AND leaky.
      return { db: this.db, provider: this.sandboxProvider };
    }
    return {
      db: this.db,
      provider: this.provider,
      ...(this.creds ? { creds: this.creds } : {}),
    };
  }

  /**
   * Is this tenant sandbox-planned? Money/carrier posture: on a read failure we fail TOWARD the
   * sandbox provider — an outage must never route an unverified tenant to a real carrier.
   */
  private async isSandboxTenant(tenantId: string): Promise<boolean> {
    try {
      const rows = (await this.db.withTenant(
        tenantId,
        (tx) => tx`SELECT plan FROM accounts WHERE id = ${tenantId}`,
      )) as Array<{ plan?: unknown }>;
      return rows[0]?.plan === "sandbox";
    } catch (error) {
      this.logger.error(
        `plan lookup failed for ${tenantId} — routing to sandbox provider: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return true;
    }
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
    const sandbox = await this.isSandboxTenant(input.tenantId);
    // Per-provider kill-switch (finding 9): halt the ACTIVE provider without pausing the platform.
    // With a single real provider there's no failover target, so a paused provider fails CLOSED
    // (never a silent send, never a faked success) — the honest behavior until a 2nd provider lands.
    // The sandbox `fake-sms` provider has no switch (nothing risky to halt). Gate here at send
    // entry so we don't reserve + enqueue for a provider that can't run.
    if (
      !sandbox &&
      (await this.killSwitch.isPaused(`provider.${this.provider.slug}`))
    ) {
      throw invalidRequest(
        "provider_unavailable",
        "The SMS provider is temporarily unavailable. Try again shortly.",
      );
    }
    // E10-S4: LIVE sends require an ACTIVE sender-id registration for the destination country —
    // in Nigeria the carrier rejects unregistered ids outright, so blocking here is honest, not
    // strict. Compliance gate → fails CLOSED (a registry outage must not push non-compliant
    // traffic). Sandbox skips it: the fake provider reaches no carrier and the quickstart keeps
    // its default sender.
    if (!sandbox) {
      const country = destinationCountry(input.to);
      const registered = await this.senders.isActiveSender(
        input.tenantId,
        input.senderId,
        country,
      );
      if (!registered) {
        throw invalidRequest(
          "sender_not_registered",
          `Sender id '${input.senderId}' is not registered (active) for ${country}. Register it under Senders first.`,
          "senderId",
        );
      }
    }
    // tx1 in-request EITHER way: insufficient funds must fail the request synchronously (a queue
    // must never accept money it can't reserve).
    const prepared = await enginePrepareSend(this.deps(sandbox), input);

    let status: SendResult["status"];
    if (this.queue.enabled) {
      // Queued path: the provider call + tx2 run in the worker with retry/backoff. jobId =
      // messageId → BullMQ dedupes, so an accidental double-enqueue is a no-op.
      await this.queue
        .queue(SMS_SEND_QUEUE)
        .add("send", { input, prepared, sandbox } satisfies SmsSendJob, {
          jobId: prepared.messageId,
          attempts: 5,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: { count: 1_000 },
          removeOnFail: { count: 5_000 },
        });
      status = "sending"; // truthful: reserved + persisted, provider outcome pending
    } else {
      // Inline fallback (no Redis configured): the pre-queue behavior, unchanged.
      const result = await engineDispatchSend(
        this.deps(sandbox),
        input,
        prepared,
      );
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
    return engineDispatchSend(
      this.deps(job.sandbox === true),
      job.input,
      job.prepared,
    );
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
    const provider =
      providerSlug === this.provider.slug
        ? this.provider
        : providerSlug === this.sandboxProvider.slug
          ? this.sandboxProvider
          : null;
    if (!provider) {
      throw notFound("unknown_provider", `no provider '${providerSlug}'`);
    }
    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const flatHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      flatHeaders[k] = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
    }
    if (!provider.verifyWebhook({ headers: flatHeaders, rawBody }, {})) {
      throw unauthorized("invalid_signature", "DLR webhook signature invalid.");
    }
    const dlr = provider.parseDlr(body);
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
    return {
      status: await engineIngestDlr(
        this.deps(provider === this.sandboxProvider),
        tenantId,
        body,
      ),
    };
  }
}

/** Destination country from the E.164 prefix — the two launch markets; anything else maps to GH
 *  until more corridors open (a send there will simply require a GH registration). */
function destinationCountry(to: string): string {
  if (to.startsWith("+234")) return "NG";
  return "GH";
}

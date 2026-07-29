import type {
  DeliveryMode,
  MessagingSettings,
  VirtualPhoneInbox,
  VirtualPhoneReplyResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { assertLiveSmsConfigured } from "./sms-live-readiness.js";
import { listVirtualInbox } from "./virtual-phone-inbox.js";
import {
  auditVirtualClear,
  clearVirtualMessages,
  recordVirtualReply,
  virtualNumberFor,
  virtualRetentionDays,
} from "./virtual-phone-operations.js";

type Row = Record<string, unknown>;

/** What the inbox shows once a recipient has exercised their right to erasure. */
/** Written before the vault existed, not yet backfilled — unreadable here, but NOT erased. */

@Injectable()
export class VirtualPhoneService {
  private readonly logger = new Logger(VirtualPhoneService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
    @Inject(PluginResolverService)
    private readonly pluginResolver: PluginResolverService,
  ) {}

  async settings(tenantId: string): Promise<MessagingSettings> {
    try {
      const rows = (await this.db.withTenant(
        tenantId,
        (tx) => tx`SELECT plan, settings FROM accounts WHERE id = ${tenantId}`,
      )) as Row[];
      const account = rows[0];
      if (!account) throw notFound("tenant_not_found", "Workspace not found.");
      if (account.plan === "sandbox") {
        return {
          delivery_mode: "virtual",
          locked: true,
          reason: "Sandbox workspaces always use the virtual phone.",
        };
      }
      const settings = isObject(account.settings) ? account.settings : {};
      const messaging = isObject(settings.messaging) ? settings.messaging : {};
      // A non-sandbox workspace defaults to LIVE and opts IN to the virtual phone — never the other
      // way round. Defaulting to virtual would silently divert every existing tenant's traffic away
      // from the carrier into a test inbox, and would bypass the E10-S4 sender-ID gate (which
      // virtual mode legitimately skips, since no carrier is involved). Sandbox is forced virtual
      // above; that is the only implicit virtual routing there is.
      return {
        delivery_mode:
          messaging.delivery_mode === "virtual" ? "virtual" : "live",
        locked: false,
        reason: null,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // FAIL CLOSED. The old fallback quietly routed to `virtual` when this lookup failed, which —
      // now that live is the default — would divert a real send into a test inbox and report it as
      // delivered. That is a faked success: the customer's message never reaches the human, and they
      // are never told. No send is strictly better than a send that silently went nowhere.
      this.logger.error(
        `delivery mode lookup failed for ${tenantId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      throw invalidRequest(
        "delivery_settings_unavailable",
        "Delivery settings are temporarily unavailable. Try again shortly.",
      );
    }
  }

  async updateSettings(
    tenantId: string,
    deliveryMode: DeliveryMode,
    actorEmail?: string,
  ): Promise<MessagingSettings> {
    const current = await this.settings(tenantId);
    if (current.delivery_mode === deliveryMode) return current;
    if (current.locked && deliveryMode !== "virtual") {
      throw invalidRequest(
        "delivery_mode_locked",
        current.reason ?? "This workspace cannot enable live delivery.",
      );
    }
    if (deliveryMode === "live") {
      await assertLiveSmsConfigured(this.pluginResolver, this.config);
      const active = (await this.db.withTenant(
        tenantId,
        (tx) => tx`
        SELECT 1 FROM senders WHERE status = 'active' LIMIT 1`,
      )) as Row[];
      if (!active[0]) {
        throw invalidRequest(
          "live_delivery_not_ready",
          "An approved sender ID is required before live carrier delivery can be enabled.",
        );
      }
    }
    await this.db.withTenant(
      tenantId,
      (tx) => tx`
      UPDATE accounts
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{messaging}',
        COALESCE(settings->'messaging', '{}'::jsonb) ||
          jsonb_build_object('delivery_mode', ${deliveryMode}::text),
        true
      ), updated_at = now()
      WHERE id = ${tenantId}`,
    );
    await this.audit.record({
      actorEmail: actorEmail ?? null,
      action: "tenant.messaging.delivery_mode_changed",
      targetType: "tenant",
      targetId: tenantId,
      summary: `Messaging delivery mode changed from ${current.delivery_mode} to ${deliveryMode}.`,
      metadata: {
        tenant_id: tenantId,
        previous_mode: current.delivery_mode,
        delivery_mode: deliveryMode,
      },
    });
    return this.settings(tenantId);
  }

  async resolveMode(tenantId: string): Promise<DeliveryMode> {
    return (await this.settings(tenantId)).delivery_mode;
  }

  /**
   * ADR-0004 routing: resolve delivery mode from the ENVIRONMENT a request arrived on, not the
   * tenant's plan. A `sandbox` environment can NEVER reach a real carrier — forced virtual, enforced
   * here in routing (not the UI). A `live` environment defaults to carrier delivery but honours a
   * tenant's opt-in to the virtual phone. Used when the request carries an environment (sk_* keys);
   * the BFF tenant-token path (no environment yet) still uses the plan-based resolveMode above.
   */
  async resolveModeForEnvironment(
    tenantId: string,
    environmentId: string,
  ): Promise<DeliveryMode> {
    try {
      const rows = (await this.db.withTenant(
        tenantId,
        (tx) => tx`
          SELECT type FROM environments
          WHERE id = ${environmentId} AND tenant_id = ${tenantId} LIMIT 1`,
      )) as Row[];
      const env = rows[0];
      if (!env) {
        throw notFound("environment_not_found", "Environment not found.");
      }
      // Sandbox: hard-pinned to virtual — a sandbox key can never reach a carrier.
      if (env.type === "sandbox") return "virtual";
      // Live: default to carrier delivery; a tenant may opt into the virtual phone via settings.
      const acctRows = (await this.db.withTenant(
        tenantId,
        (tx) => tx`SELECT settings FROM accounts WHERE id = ${tenantId}`,
      )) as Row[];
      const account = acctRows[0];
      const settings = isObject(account?.settings) ? account.settings : {};
      const messaging = isObject(settings.messaging) ? settings.messaging : {};
      return messaging.delivery_mode === "virtual" ? "virtual" : "live";
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Fail closed — same posture as settings(): never silently divert a real send into the inbox.
      this.logger.error(
        `env delivery mode lookup failed for ${tenantId}/${environmentId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      throw invalidRequest(
        "delivery_settings_unavailable",
        "Delivery settings are temporarily unavailable. Try again shortly.",
      );
    }
  }

  /**
   * Persist the tenant-visible projection of a virtual send. The body goes into the PII vault under
   * the recipient's own DEK and only its surrogate is stored here, so a later erasure of that
   * recipient renders this message unreadable too — which is precisely what the previous
   * platform-key encryption could not do.
   */
  async record(input: {
    tenantId: string;
    messageId: string;
    subjectId: string;
    body: string;
    bodyPiiId?: string;
  }): Promise<void> {
    const bodyPiiId =
      input.bodyPiiId ??
      (await this.vault.put(
        input.tenantId,
        input.subjectId,
        "body",
        input.body,
      ));
    await this.db.withTenant(
      input.tenantId,
      (tx) => tx`
      INSERT INTO virtual_deliveries (
        message_id, tenant_id, subject_id, body_pii_id
      ) VALUES (
        ${input.messageId}, current_setting('app.tenant_id')::uuid,
        ${input.subjectId}, ${bodyPiiId}
      ) ON CONFLICT (message_id) DO NOTHING`,
    );
  }

  async list(
    tenantId: string,
    opts: { cursor?: string; limit?: number; recipient?: string } = {},
  ): Promise<VirtualPhoneInbox> {
    return listVirtualInbox({
      db: this.db,
      vault: this.vault,
      tenantId,
      virtualNumber: this.virtualNumber(tenantId),
      retentionDays: virtualRetentionDays(this.config),
      ...opts,
    });
  }

  async reply(
    tenantId: string,
    input: { to: string; body: string },
  ): Promise<VirtualPhoneReplyResponse> {
    return recordVirtualReply({
      db: this.db,
      vault: this.vault,
      tenantId,
      ...input,
    });
  }

  virtualNumber(tenantId: string): string {
    return virtualNumberFor(tenantId);
  }

  async markRead(tenantId: string, messageId: string): Promise<void> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      UPDATE virtual_deliveries
      SET read_at = COALESCE(read_at, now()), updated_at = now()
      WHERE message_id = ${messageId}
      RETURNING message_id`,
    )) as Row[];
    if (!rows[0])
      throw notFound("virtual_message_not_found", "Message not found.");
  }

  async clear(tenantId: string, actorEmail?: string): Promise<number> {
    const cleared = await clearVirtualMessages({ db: this.db, tenantId });
    await auditVirtualClear({
      audit: this.audit,
      tenantId,
      ...(actorEmail ? { actorEmail } : {}),
      cleared,
    });
    return cleared;
  }

  async purgeExpired(tenantId: string, cutoffIso: string): Promise<number> {
    return clearVirtualMessages({
      db: this.db,
      tenantId,
      before: cutoffIso,
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

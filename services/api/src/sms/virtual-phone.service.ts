import type {
  DeliveryMode,
  MessagingSettings,
  VirtualPhoneInbox,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { assertLiveProviderReady } from "./sms-providers.js";

type Row = Record<string, unknown>;

/** What the inbox shows once a recipient has exercised their right to erasure. */
const ERASED_PLACEHOLDER = "[erased]";

@Injectable()
export class VirtualPhoneService {
  private readonly logger = new Logger(VirtualPhoneService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
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
      return {
        delivery_mode: messaging.delivery_mode === "live" ? "live" : "virtual",
        locked: false,
        reason: null,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "HttpException") throw error;
      this.logger.error(
        `delivery mode lookup failed for ${tenantId}; failing toward virtual: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return {
        delivery_mode: "virtual",
        locked: true,
        reason: "Delivery settings are temporarily unavailable.",
      };
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
      try {
        assertLiveProviderReady(this.config);
      } catch (error) {
        throw invalidRequest(
          "live_provider_not_ready",
          error instanceof Error
            ? error.message
            : "Live SMS is not configured.",
        );
      }
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
  }): Promise<void> {
    const bodyPiiId = await this.vault.put(
      input.tenantId,
      input.subjectId,
      "body",
      input.body,
    );
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

  async list(tenantId: string): Promise<VirtualPhoneInbox> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT m.id, m.sender_id, m.status, m.segments, m.created_at,
             v.subject_id, v.body_pii_id, v.read_at
      FROM virtual_deliveries v
      JOIN messages m ON m.id = v.message_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 100`,
    )) as Row[];

    // Two batched vault reads for the whole page — never one per row.
    const [bodies, phones] = await Promise.all([
      this.vault.readMany(
        tenantId,
        rows.flatMap((row) =>
          row.body_pii_id ? [String(row.body_pii_id)] : [],
        ),
      ),
      this.vault.readPhones(tenantId, [
        ...new Set(
          rows.flatMap((row) =>
            row.subject_id ? [String(row.subject_id)] : [],
          ),
        ),
      ]),
    ]);

    return {
      messages: rows.map((row) => {
        const bodyId = row.body_pii_id ? String(row.body_pii_id) : null;
        const subjectId = row.subject_id ? String(row.subject_id) : null;
        // An erased subject leaves the message in place with its PII gone — a first-class state the
        // UI renders, not an error. Same for a row we simply cannot read.
        const to = subjectId ? (phones.get(subjectId) ?? null) : null;
        const body = bodyId ? (bodies.get(bodyId) ?? null) : null;
        return {
          id: String(row.id),
          to: to ?? ERASED_PLACEHOLDER,
          from: String(row.sender_id),
          body: body ?? ERASED_PLACEHOLDER,
          erased: to === null || body === null,
          status: row.status as VirtualPhoneInbox["messages"][number]["status"],
          segments: Number(row.segments),
          created_at: new Date(String(row.created_at)).toISOString(),
          read_at: row.read_at
            ? new Date(String(row.read_at)).toISOString()
            : null,
        };
      }),
    };
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
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

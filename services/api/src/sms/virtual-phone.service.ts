import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
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
import { assertLiveProviderReady } from "./sms-providers.js";

type Row = Record<string, unknown>;

@Injectable()
export class VirtualPhoneService {
  private readonly logger = new Logger(VirtualPhoneService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
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

  async record(input: {
    tenantId: string;
    messageId: string;
    to: string;
    body: string;
  }): Promise<void> {
    await this.db.withTenant(
      input.tenantId,
      (tx) => tx`
      INSERT INTO virtual_deliveries (
        message_id, tenant_id, recipient_ciphertext, body_ciphertext
      ) VALUES (
        ${input.messageId}, current_setting('app.tenant_id')::uuid,
        ${this.encrypt(input.to, input.tenantId, input.messageId)},
        ${this.encrypt(input.body, input.tenantId, input.messageId)}
      ) ON CONFLICT (message_id) DO NOTHING`,
    );
  }

  async list(tenantId: string): Promise<VirtualPhoneInbox> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
      SELECT m.id, m.sender_id, m.status, m.segments, m.created_at,
             v.recipient_ciphertext, v.body_ciphertext, v.read_at
      FROM virtual_deliveries v
      JOIN messages m ON m.id = v.message_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 100`,
    )) as Row[];
    return {
      messages: rows.map((row) => {
        const id = String(row.id);
        return {
          id,
          to: this.decrypt(String(row.recipient_ciphertext), tenantId, id),
          from: String(row.sender_id),
          body: this.decrypt(String(row.body_ciphertext), tenantId, id),
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

  private key(): Buffer {
    const secret = this.config.get<string>("VIRTUAL_PHONE_ENCRYPTION_KEY");
    if (!secret || secret.length < 32) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw new Error(
          "VIRTUAL_PHONE_ENCRYPTION_KEY must be at least 32 characters.",
        );
      }
      return createHash("sha256")
        .update("fabric-local-virtual-phone-development-key")
        .digest();
    }
    return createHash("sha256").update(secret).digest();
  }

  private encrypt(value: string, tenantId: string, messageId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(`${tenantId}:${messageId}`));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  private decrypt(value: string, tenantId: string, messageId: string): string {
    const [version, iv, encrypted, tag] = value.split(".");
    if (version !== "v1" || !iv || !encrypted || !tag)
      throw new Error("Invalid virtual delivery ciphertext.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`${tenantId}:${messageId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

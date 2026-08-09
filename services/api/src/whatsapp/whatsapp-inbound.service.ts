import type { AppDb, ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import {
  attributeInbound,
  SERVICE_WINDOW_MS,
} from "./whatsapp-inbound-attribution.js";
import { type ParsedInboundMessage, toE164 } from "./whatsapp-inbound-parse.js";

/**
 * Ingest inbound WhatsApp messages (ADR-0015). Attribute, store, extend the service window, emit the
 * event — in that order, and idempotently on Meta's `wamid`, because Meta retries any webhook it
 * believes failed and a retry must not produce a second row, a second event, or a second window
 * extension.
 *
 * An unattributable message is RECORDED, not dropped and not guessed at. A steady rate of them is the
 * evidence for moving to per-tenant numbers; suppressing them would hide exactly the signal that
 * decision needs.
 */
@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
  ) {}

  /** Returns how many messages were newly ingested — a replayed webhook contributes zero. */
  async ingest(
    providerSlug: string,
    messages: readonly ParsedInboundMessage[],
  ): Promise<number> {
    let ingested = 0;
    for (const message of messages) {
      ingested += (await this.ingestOne(providerSlug, message)) ? 1 : 0;
    }
    return ingested;
  }

  private async ingestOne(
    providerSlug: string,
    message: ParsedInboundMessage,
  ): Promise<boolean> {
    const e164 = toE164(message.from);
    const attribution = await attributeInbound(
      { provisioning: this.provisioning, vault: this.vault },
      { e164, providerSlug, receivedAt: message.receivedAt },
    );
    if (!attribution) {
      await this.recordUnattributed(message);
      return false;
    }
    const { tenantId, subjectId, applicationId, environmentId } = attribution;
    // Encrypt BEFORE the transaction, matching every other write path: the vault write is idempotent
    // per content and a rolled-back transaction leaves an orphan ciphertext, not a leak.
    const contentPiiId = await this.vault.put(
      tenantId,
      subjectId,
      "body",
      JSON.stringify(message.raw),
    );
    const expiresAt = new Date(
      message.receivedAt.getTime() + SERVICE_WINDOW_MS,
    );
    return this.db.withTenant(tenantId, async (tx) => {
      const inserted = (await tx`
        INSERT INTO whatsapp_inbound_messages (
          tenant_id, application_id, environment_id, subject_id, content_pii_id,
          provider_ref, message_type, received_at
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${applicationId}, ${environmentId},
          ${subjectId}, ${contentPiiId}, ${message.providerRef}, ${message.type},
          ${message.receivedAt.toISOString()}::text::timestamptz
        ) ON CONFLICT (tenant_id, provider_ref) DO NOTHING
        RETURNING id`) as Array<Record<string, unknown>>;
      const row = inserted[0];
      // No row means Meta replayed this wamid. Stop here: the window was already extended and the
      // event already emitted, and doing either again would double-deliver a webhook to the customer.
      if (!row) return false;
      await tx`
        INSERT INTO whatsapp_service_windows (
          tenant_id, subject_id, last_inbound_at, expires_at
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${subjectId},
          ${message.receivedAt.toISOString()}::text::timestamptz,
          ${expiresAt.toISOString()}::text::timestamptz
        ) ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
          last_inbound_at = EXCLUDED.last_inbound_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = now()
        WHERE whatsapp_service_windows.last_inbound_at < EXCLUDED.last_inbound_at`;
      await tx`
        INSERT INTO outbox_events (
          tenant_id, application_id, environment_id, event_type, payload
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${applicationId}, ${environmentId},
          'message.received',
          ${JSON.stringify({
            id: String(row.id),
            subject_id: subjectId,
            channel: "whatsapp",
            message_type: message.type,
          })}::jsonb
        )`;
      return true;
    });
  }

  /**
   * A message no tenant owns. Written through the provisioning connection because there is no tenant
   * to scope it to — and carrying NOTHING about the consumer: with no tenant there is no vault scope
   * to encrypt their number into, and the row exists to be counted, not read.
   */
  private async recordUnattributed(
    message: ParsedInboundMessage,
  ): Promise<void> {
    await this.provisioning.db.execute(sql`
      INSERT INTO whatsapp_unattributed_inbound (
        provider_ref, phone_number_id, message_type, received_at
      ) VALUES (
        ${message.providerRef}, ${message.phoneNumberId}, ${message.type},
        ${message.receivedAt.toISOString()}::text::timestamptz
      ) ON CONFLICT (provider_ref) DO NOTHING`);
    this.logger.warn(
      `whatsapp inbound ${message.providerRef} on ${message.phoneNumberId} matched no tenant inside the service window`,
    );
  }
}

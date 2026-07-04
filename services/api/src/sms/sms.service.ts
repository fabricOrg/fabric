import {
  currency,
  type MessageDetail,
  type MessageStatus,
  type MessageSummary,
  type SendSmsResponse,
} from "@app/contracts";
import { type AppDb, findCustomerMessage, listCustomerMessages } from "@app/db";
import type { SmsSenderPlugin } from "@app/integrations";
import { FakeProvider } from "@app/integrations/testing";
import {
  ingestDlr as engineIngestDlr,
  sendSms as engineSendSms,
  type SendResult,
} from "@app/sms-engine";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { notFound, unauthorized } from "../http/api-error.js";

interface Row {
  tenant_id?: unknown;
  [key: string]: unknown;
}

/**
 * Wires the HTTP boundary to the L5 send pipeline. Holds the EngineDeps (the app_runtime AppDb + the
 * SMS provider) and exposes send + DLR-ingest. Thin-thread provider = FakeProvider; a real vendor
 * adapter swaps in here (the engine + controllers are provider-agnostic via SmsSenderPlugin).
 */
@Injectable()
export class SmsService {
  // One provider instance for the iteration (FakeProvider). Real adapters are DI-swappable later.
  private readonly provider: SmsSenderPlugin = new FakeProvider();

  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  private deps() {
    return { db: this.db, provider: this.provider };
  }

  /** POST /v1/sms/send — the tenant is already resolved by ApiKeyGuard. */
  async send(input: {
    tenantId: string;
    to: string;
    senderId: string;
    body: string;
    currency: string;
  }): Promise<SendSmsResponse> {
    const result: SendResult = await engineSendSms(this.deps(), input);
    const message = await this.get(input.tenantId, result.messageId);
    return {
      id: message.id,
      status: result.status,
      encoding: message.encoding,
      segments: message.segments,
      cost: message.cost,
    };
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

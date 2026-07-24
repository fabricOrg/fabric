import type {
  CreateSenderRequest,
  DecideSenderRequest,
  SenderDto,
} from "@app/contracts";
import { type AppDb, type ProvisioningDb, senders } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

interface Actor {
  readonly email: string;
  readonly staffId?: string | null;
}

/**
 * Sender-ID registry (E10 / C-2). Customers register sender ids per country; staff decide after
 * carrier/NCC review; the SMS send path enforces `active` for LIVE tenants (see SmsService).
 * Tenant paths run under RLS on app_runtime; the staff review queue + decisions run on the
 * provisioning connection (cross-tenant, permissive policy).
 */
@Injectable()
export class SendersService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<SenderDto[]> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select()
        .from(senders)
        .where(eq(senders.tenantId, tenantId as never))
        .orderBy(desc(senders.createdAt)),
    );
    return rows.map(toDto);
  }

  async create(
    tenantId: string,
    request: CreateSenderRequest,
  ): Promise<SenderDto> {
    const senderId = request.sender_id.trim();
    const [created] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .insert(senders)
        .values({
          tenantId: tenantId as never,
          senderId,
          country: request.country,
          type: request.type,
          useCase: request.use_case,
        })
        .onConflictDoNothing({
          target: [senders.tenantId, senders.senderId, senders.country],
        })
        .returning(),
    );
    if (!created) {
      throw invalidRequest(
        "sender_already_registered",
        "This sender id is already registered (or awaiting review) for that country.",
        "sender_id",
      );
    }
    return toDto(created);
  }

  /** Send-path gate: does this LIVE tenant hold an ACTIVE registration for the sender id in the
   *  destination country? Compliance/delivery gate → a read failure blocks the send (closed). */
  async isActiveSender(
    tenantId: string,
    senderId: string,
    country: string,
  ): Promise<boolean> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({ id: senders.id })
        .from(senders)
        .where(
          and(
            eq(senders.tenantId, tenantId as never),
            eq(senders.senderId, senderId),
            eq(senders.country, country),
            eq(senders.status, "active"),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }

  async senderStatus(
    tenantId: string,
    senderId: string,
    country: string,
  ): Promise<"active" | "pending" | "rejected" | "unregistered"> {
    const [row] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .select({ status: senders.status })
        .from(senders)
        .where(
          and(
            eq(senders.tenantId, tenantId as never),
            eq(senders.senderId, senderId),
            eq(senders.country, country),
          ),
        )
        .limit(1),
    );
    return row?.status ?? "unregistered";
  }

  /** Staff review queue — pending first, cross-tenant on the provisioning connection. */
  async reviewQueue(): Promise<Array<SenderDto & { tenant_id: string }>> {
    const rows = await this.provisioning.db
      .select()
      .from(senders)
      .orderBy(asc(senders.status), desc(senders.createdAt));
    return rows.map((row) => ({ ...toDto(row), tenant_id: row.tenantId }));
  }

  async decide(
    id: string,
    request: DecideSenderRequest,
    actor: Actor,
  ): Promise<SenderDto> {
    const [current] = await this.provisioning.db
      .select()
      .from(senders)
      .where(eq(senders.id, id))
      .limit(1);
    if (!current) throw notFound("sender_not_found", "Unknown sender id.");
    if (current.status !== "pending") {
      throw invalidRequest(
        "already_decided",
        "This registration has already been decided.",
      );
    }
    const [updated] = await this.provisioning.db
      .update(senders)
      .set({
        status: request.status,
        rejectionReason:
          request.status === "rejected" ? (request.reason ?? null) : null,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(senders.id, id))
      .returning();
    if (!updated) throw new Error("Sender decision returned no row.");
    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email,
      action: `sender.${request.status}`,
      targetType: "sender",
      targetId: id,
      summary: `Sender '${current.senderId}' (${current.country}) ${request.status}`,
      reason: request.reason ?? null,
      metadata: { tenant_id: current.tenantId },
    });
    return toDto(updated);
  }
}

function toDto(row: typeof senders.$inferSelect): SenderDto {
  return {
    id: row.id,
    sender_id: row.senderId,
    country: row.country as SenderDto["country"],
    type: row.type as SenderDto["type"],
    use_case: row.useCase,
    status: row.status,
    rejection_reason: row.rejectionReason,
    created_at: row.createdAt.toISOString(),
  };
}

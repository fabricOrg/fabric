import type {
  CreateSmsTemplateRequest,
  SmsTemplate,
  UpdateSmsTemplateRequest,
} from "@app/contracts";
import { messageClass } from "@app/contracts";
import { type AppDb, smsTemplates, type TenantId } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest, notFound } from "../http/api-error.js";

@Injectable()
export class SmsTemplatesService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async list(tenantId: string): Promise<SmsTemplate[]> {
    const rows = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx.select().from(smsTemplates).orderBy(desc(smsTemplates.updatedAt)),
    );
    return rows.map(toDto);
  }

  async create(
    tenantId: string,
    input: CreateSmsTemplateRequest,
  ): Promise<SmsTemplate> {
    const [created] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .insert(smsTemplates)
        .values({
          tenantId: tenantId as TenantId,
          name: input.name,
          body: input.body,
          messageClass: input.class,
        })
        .onConflictDoNothing({
          target: [smsTemplates.tenantId, smsTemplates.name],
        })
        .returning(),
    );
    if (!created) {
      throw invalidRequest(
        "sms_template_name_taken",
        "A template with this name already exists.",
        "name",
      );
    }
    return toDto(created);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateSmsTemplateRequest,
  ): Promise<SmsTemplate> {
    let updated: typeof smsTemplates.$inferSelect | undefined;
    try {
      [updated] = await this.db.withTenantDrizzle(tenantId, (tx) =>
        tx
          .update(smsTemplates)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.class !== undefined ? { messageClass: input.class } : {}),
            updatedAt: new Date(),
          })
          .where(eq(smsTemplates.id, id))
          .returning(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw invalidRequest(
          "sms_template_name_taken",
          "A template with this name already exists.",
          "name",
        );
      }
      throw error;
    }
    if (!updated) {
      throw notFound("sms_template_not_found", "SMS template not found.");
    }
    return toDto(updated);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const [removed] = await this.db.withTenantDrizzle(tenantId, (tx) =>
      tx
        .delete(smsTemplates)
        .where(eq(smsTemplates.id, id))
        .returning({ id: smsTemplates.id }),
    );
    if (!removed) {
      throw notFound("sms_template_not_found", "SMS template not found.");
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function toDto(row: typeof smsTemplates.$inferSelect): SmsTemplate {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    class: messageClass.parse(row.messageClass),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

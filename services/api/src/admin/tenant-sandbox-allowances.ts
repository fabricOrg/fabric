import type {
  SandboxAllowancePolicy,
  UpdateSandboxAllowancePolicy,
} from "@app/contracts";
import { accounts, type ProvisioningDb, type TenantId } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { eq, sql } from "drizzle-orm";
import type { AuditService } from "../audit/audit.service.js";
import { notFound } from "../http/api-error.js";
import {
  resolveSandboxAllowanceLimits,
  sandboxAllowanceDefaults,
} from "../sandbox-allowance/sandbox-allowance-limits.js";

export interface AllowanceActor {
  readonly staffId?: string | null;
  readonly email?: string | null;
}

export async function getTenantSandboxAllowancePolicy(
  provisioning: ProvisioningDb,
  config: ConfigService,
  tenantId: string,
): Promise<SandboxAllowancePolicy> {
  const [account] = await provisioning.db
    .select({ settings: accounts.settings })
    .from(accounts)
    .where(eq(accounts.id, tenantId as TenantId))
    .limit(1);
  if (!account) throw notFound("tenant_not_found", "No tenant with that id.");
  const limits = resolveSandboxAllowanceLimits(
    account.settings,
    sandboxAllowanceDefaults(config),
  );
  return {
    sms_segments_per_day: Number(limits.sms),
    email_messages_per_day: Number(limits.email),
  };
}

export async function setTenantSandboxAllowancePolicy(
  provisioning: ProvisioningDb,
  config: ConfigService,
  audit: AuditService,
  tenantId: string,
  request: UpdateSandboxAllowancePolicy,
  actor: AllowanceActor,
): Promise<SandboxAllowancePolicy> {
  const before = await getTenantSandboxAllowancePolicy(
    provisioning,
    config,
    tenantId,
  );
  const [updated] = await provisioning.db
    .update(accounts)
    .set({
      settings: sql`jsonb_set(
        ${accounts.settings},
        '{sandbox_allowances}',
        COALESCE(${accounts.settings}->'sandbox_allowances', '{}'::jsonb)
          || jsonb_build_object(
            'sms_segments_per_day', ${String(request.sms_segments_per_day)}::text,
            'email_messages_per_day', ${String(request.email_messages_per_day)}::text
          ),
        true
      )`,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, tenantId as TenantId))
    .returning({ id: accounts.id });
  if (!updated) throw notFound("tenant_not_found", "No tenant with that id.");

  const after = {
    sms_segments_per_day: request.sms_segments_per_day,
    email_messages_per_day: request.email_messages_per_day,
  };
  await audit.record({
    actorStaffId: actor.staffId ?? null,
    actorEmail: actor.email ?? null,
    action: "tenant.sandbox_allowance_updated",
    targetType: "tenant",
    targetId: tenantId,
    summary: "Sandbox daily channel allowances updated",
    reason: request.reason,
    metadata: { before, after },
  });
  return after;
}

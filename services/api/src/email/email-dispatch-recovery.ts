import type { SendEmailApiResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";

type Row = Record<string, unknown>;

export async function emailDispatchBlockReason(
  killSwitch: KillSwitchService,
): Promise<string | null> {
  try {
    if (await killSwitch.isPaused("platform.email_sending")) {
      return "email_sending_paused";
    }
  } catch {
    // Fail open: this control-plane read must not strand queued data-plane traffic.
  }
  return null;
}

export async function sweepManagedEmailExpired(
  db: AppDb,
  tenantId: string,
  olderThanIso: string,
  resolve: (
    tenantId: string,
    messageId: string,
    status: SendEmailApiResponse["status"],
    detail: { errorCode?: string },
  ) => Promise<SendEmailApiResponse["status"]>,
): Promise<number> {
  const stuck = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT m.id FROM email_messages m
      WHERE m.status IN ('queued','sending','sent')
        AND m.updated_at < ${olderThanIso}::timestamptz
        AND EXISTS (
          SELECT 1 FROM message_delivery_attempts a
          WHERE a.email_message_id = m.id
        )
      FOR UPDATE`,
  )) as Row[];
  for (const row of stuck) {
    await resolve(tenantId, String(row.id), "expired", {
      errorCode: "dispatch_expired",
    });
  }
  return stuck.length;
}

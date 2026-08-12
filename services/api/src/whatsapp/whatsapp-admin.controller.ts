import type { ProvisioningDb } from "@app/db";
import { Controller, Headers, Inject, Post, UseGuards } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { WhatsappTemplateSyncScheduler } from "./whatsapp-template-sync.scheduler.js";

/** Refuse a re-run inside this window. See the throttle note on the route. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Run the WhatsApp template sync on demand.
 *
 * The hourly `@Cron` is the steady-state caller, and on the free-tier testing host it effectively
 * never fires: the service sleeps after ~15 minutes idle (render.yaml), and a sleeping process runs
 * no cron. So the capability shipped with a trigger that does not pull — the template cache stays
 * empty, and the compose picker tells a customer to go and create templates somewhere they cannot
 * reach. This gives an operator a way to pull it.
 *
 * Staff/internal, BFF-token guarded like the other control-plane endpoints. Deliberately NOT
 * tenant-scoped: the sync decides for itself which tenants the WABA applies to, and letting a caller
 * name one would hand them a lever to write into another workspace's cache.
 *
 * NOTE it bypasses both switches the cron respects — `runtimeRoleEnabled(config, "scheduler")` and
 * `MAINTENANCE_CRON_ENABLED`. That is the point of an override, but it means turning maintenance work
 * off does not disable this route.
 */
@Controller("internal/admin/whatsapp")
@UseGuards(BffTokenGuard)
export class WhatsappAdminController {
  constructor(
    @Inject(WhatsappTemplateSyncScheduler)
    private readonly scheduler: WhatsappTemplateSyncScheduler,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  @Post("template-sync")
  async syncTemplates(@Headers("x-actor-email") actorEmail?: string) {
    // Throttled, because one call is not one request to Meta: the sync fans out a paginated Graph
    // fetch per discovered tenant, inside a transaction holding one of only two provisioning
    // connections. The advisory lock stops runs OVERLAPPING but not a caller firing them
    // back-to-back, which would trip the app-level Graph rate limit and degrade real sends with it.
    await this.assertNotJustSynced();

    const actor = actorEmail ?? null;
    try {
      const result = await this.scheduler.run();
      await this.audit.record({
        actorEmail: actor,
        action: "whatsapp.template_sync.run",
        targetType: "platform",
        summary: result.locked
          ? `Synced WhatsApp templates for ${result.synced} record(s).`
          : "WhatsApp template sync skipped — another run held the lock.",
        metadata: { outcome: "ok", ...result },
      });
      return result;
    } catch (error) {
      // Audited on failure too. The first operator use is exactly when this breaks — an unarmed
      // credential throws before anything syncs — and "nobody can see who tried" is the worst
      // possible answer to that.
      await this.audit.record({
        actorEmail: actor,
        action: "whatsapp.template_sync.run",
        targetType: "platform",
        summary: "WhatsApp template sync failed.",
        metadata: {
          outcome: "failed",
          error: error instanceof Error ? error.message : "unknown",
        },
      });
      throw error;
    }
  }

  private async assertNotJustSynced(): Promise<void> {
    const rows = (await this.provisioning.db.execute(sql`
      SELECT max(synced_at) AS synced_at FROM whatsapp_templates`)) as Array<{
      synced_at: string | Date | null;
    }>;
    const latest = rows[0]?.synced_at;
    if (!latest) return;
    const age = Date.now() - new Date(latest).getTime();
    if (age < MIN_INTERVAL_MS) {
      throw invalidRequest(
        "whatsapp_template_sync_throttled",
        `The catalog was refreshed ${Math.round(age / 1000)}s ago. Try again in a few minutes.`,
      );
    }
  }
}

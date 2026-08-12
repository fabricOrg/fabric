import { Controller, Headers, Inject, Post, UseGuards } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { WhatsappTemplateSyncScheduler } from "./whatsapp-template-sync.scheduler.js";

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
 * Safe to call repeatedly. `run()` takes a transaction-scoped advisory lock, so a concurrent cron
 * tick or a second operator returns `{ locked: false }` rather than syncing twice.
 */
@Controller("internal/admin/whatsapp")
@UseGuards(BffTokenGuard)
export class WhatsappAdminController {
  constructor(
    @Inject(WhatsappTemplateSyncScheduler)
    private readonly scheduler: WhatsappTemplateSyncScheduler,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post("template-sync")
  async syncTemplates(@Headers("x-actor-email") actorEmail?: string) {
    const result = await this.scheduler.run();
    // Audited because it reaches an external vendor with the platform's live credential, and because
    // "who refreshed the catalog, and when" is the first question asked when a template appears or
    // disappears unexpectedly.
    await this.audit.record({
      actorEmail: actorEmail ?? null,
      action: "whatsapp.template_sync.run",
      targetType: "platform",
      summary: result.locked
        ? `Synced WhatsApp templates for ${result.synced} record(s).`
        : "WhatsApp template sync skipped — another run held the lock.",
      metadata: { locked: result.locked, synced: result.synced },
    });
    return result;
  }
}

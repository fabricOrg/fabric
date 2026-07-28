import type { PluginInstanceDto } from "@app/contracts";
import {
  type ProvisioningDb,
  pluginCredentials,
  pluginInstances,
} from "@app/db";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { CATALOG } from "./plugin-catalog.js";
import { PluginResolverService } from "./plugin-resolver.service.js";

/**
 * Platform plugin registry (docs/PI-5/PLUGIN-REGISTRY.md). plugin_instances is GLOBAL config (no
 * tenant/RLS) — staff-managed via the control plane. `resolve()` is the shared selection/failover
 * mechanism callers use (primary first, then fallbacks). Going live is a redline handled elsewhere.
 */

type Row = typeof pluginInstances.$inferSelect;

function toDto(
  row: Row,
  credentialFingerprint: string | null = null,
): PluginInstanceDto {
  return {
    id: row.id,
    capability: row.capability,
    vendor: row.vendor,
    label: row.label,
    enabled: row.enabled,
    isDefault: row.isDefault,
    status: row.status,
    mode: row.mode,
    credential_fingerprint: credentialFingerprint,
  };
}

@Injectable()
export class PluginRegistryService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    // Optional for direct construction in tests; when present, every mutation drops its cache so a
    // disable or re-seat takes effect now rather than after the TTL.
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  /** Idempotently seed the platform provider catalog (first run leaves the table populated). */
  private async ensureCatalog(): Promise<void> {
    await this.provisioning.db
      .insert(pluginInstances)
      .values(CATALOG)
      // Must match uniq_plugin_instance exactly, or Postgres cannot infer an arbiter index and the
      // seed fails outright (42P10). Slice 3 widened that key to include tenant_id + mode.
      .onConflictDoNothing({
        target: [
          pluginInstances.tenantId,
          pluginInstances.capability,
          pluginInstances.vendor,
          pluginInstances.mode,
        ],
      });
  }

  async list(): Promise<PluginInstanceDto[]> {
    await this.ensureCatalog();
    // LEFT JOIN so staff can see WHICH credential is installed without a second round trip. The
    // fingerprint is derived and non-reversible — the ciphertext and DEK are never selected here.
    const rows = await this.provisioning.db
      .select({
        instance: pluginInstances,
        fingerprint: pluginCredentials.fingerprint,
        dekWrapped: pluginCredentials.dekWrapped,
      })
      .from(pluginInstances)
      .leftJoin(
        pluginCredentials,
        eq(pluginCredentials.id, pluginInstances.credentialsRef),
      )
      .orderBy(asc(pluginInstances.capability), asc(pluginInstances.priority));
    return rows.map((row) =>
      // A revoked credential (NULL dek_wrapped) reports as absent: showing a fingerprint for a
      // secret nothing can decrypt would imply the instance is configured when it cannot send.
      toDto(row.instance, row.dekWrapped ? row.fingerprint : null),
    );
  }

  /** The failover chain for a capability: enabled instances, primary (priority 0) first. */
  async resolve(capability: Row["capability"]): Promise<PluginInstanceDto[]> {
    const rows = await this.provisioning.db
      .select()
      .from(pluginInstances)
      .where(
        and(
          eq(pluginInstances.capability, capability),
          eq(pluginInstances.enabled, true),
        ),
      )
      .orderBy(asc(pluginInstances.priority));
    // Arrow, not a bare `toDto` reference: Array.map passes the INDEX as the second argument, which
    // would land in the fingerprint parameter.
    return rows.map((row) => toDto(row));
  }

  async apply(
    id: string,
    action: "enable" | "disable" | "make-default" | "activate-live",
  ): Promise<PluginInstanceDto | null> {
    return this.provisioning.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(pluginInstances)
        .where(eq(pluginInstances.id, id))
        .limit(1);
      if (!current) return null;

      // ADR-0011 §5: putting an instance on a real carrier is not the same act as enabling a
      // sandbox one. It refuses without installed credentials, because `enabled + live + no key`
      // resolves to a provider that fails every send — an outage dressed up as configuration.
      if (action === "activate-live") {
        if (current.mode !== "live") {
          throw invalidRequest(
            "not_a_live_instance",
            "Only a live-mode instance can be activated for carrier delivery.",
            "id",
          );
        }
        if (!current.credentialsRef) {
          throw invalidRequest(
            "credentials_required",
            "Install this provider's credentials before activating live delivery.",
            "id",
          );
        }
      }

      if (action === "make-default") {
        // Demote the current primary in this capability AND MODE, then promote this instance.
        // Scoping by capability alone predates slice 3: it would reset every live instance's
        // priority to 100 when a sandbox one was promoted, leaving live resolution to fall back on
        // whatever order the database returned. Primary is a per-mode notion.
        await tx
          .update(pluginInstances)
          .set({ isDefault: false, priority: 100, updatedAt: new Date() })
          .where(
            and(
              eq(pluginInstances.capability, current.capability),
              eq(pluginInstances.mode, current.mode),
              current.tenantId
                ? eq(pluginInstances.tenantId, current.tenantId)
                : isNull(pluginInstances.tenantId),
            ),
          );
        await tx
          .update(pluginInstances)
          .set({
            isDefault: true,
            enabled: true,
            // NOT `connected` — see the status note below.
            status: current.status === "connected" ? "connected" : "available",
            priority: 0,
            updatedAt: new Date(),
          })
          .where(eq(pluginInstances.id, id));
      } else {
        const enabled = action !== "disable";
        await tx
          .update(pluginInstances)
          .set({
            enabled,
            /**
             * ADR-0011 §6 — status must be EARNED. Enabling a toggle is not evidence we ever
             * reached the vendor, and this previously set `connected` on enable: a guess presented
             * to staff as fact. `available` means configured-and-selectable; `connected` is set
             * only by a dispatch that actually succeeded (see markDispatchOutcome). Toggling
             * therefore RESETS an earned status — it must be re-earned, not remembered.
             */
            status: "available",
            isDefault: enabled ? current.isDefault : false,
            updatedAt: new Date(),
          })
          .where(eq(pluginInstances.id, id));
      }

      const [updated] = await tx
        .select()
        .from(pluginInstances)
        .where(eq(pluginInstances.id, id))
        .limit(1);
      // Enabling, disabling, re-seating the primary or activating live all change WHO carries
      // traffic. Without dropping the resolver cache the change takes up to the TTL to apply — and
      // for `disable`, that means a provider staff believe they switched off keeps sending.
      this.resolver?.invalidate();
      return updated ? toDto(updated) : null;
    });
  }

  /**
   * Create the LIVE sibling of a vendor's catalog entry. Slice 3 keys instances by
   * (tenant_id, capability, vendor, mode), so live is its own row with its OWN credentials —
   * flipping the sandbox row's mode would repoint sandbox traffic at a carrier instead.
   *
   * Born disabled with no credentials: creating the row is not activating it.
   */
  async createLiveInstance(request: {
    vendor: string;
    capability: "sms" | "whatsapp" | "payment" | "identity";
    label?: string | undefined;
  }): Promise<PluginInstanceDto> {
    const vendor = request.vendor.trim().toLowerCase();
    const [existing] = await this.provisioning.db
      .select()
      .from(pluginInstances)
      .where(
        and(
          isNull(pluginInstances.tenantId),
          eq(pluginInstances.capability, request.capability),
          eq(pluginInstances.vendor, vendor),
          eq(pluginInstances.mode, "live"),
        ),
      )
      .limit(1);
    if (existing) return toDto(existing);

    const [created] = await this.provisioning.db
      .insert(pluginInstances)
      .values({
        capability: request.capability,
        vendor,
        label: request.label?.trim() || `${vendor} (live)`,
        enabled: false,
        isDefault: false,
        mode: "live",
        status: "available",
        priority: 0,
      })
      .returning();
    if (!created) throw new Error("Live instance insert returned no row.");
    return toDto(created);
  }

  /**
   * ADR-0011 §6: `connected` means we have actually talked to the vendor. The send path calls this
   * with what really happened, so the Plugins page reports observed reality rather than intent.
   *
   * Best-effort and never on the critical path — a status write must not fail a send that worked.
   */
  async markDispatchOutcome(
    vendor: string,
    mode: "sandbox" | "live",
    outcome: "ok" | "error",
  ): Promise<void> {
    try {
      await this.provisioning.db
        .update(pluginInstances)
        .set({
          status: outcome === "ok" ? "connected" : "error",
          updatedAt: new Date(),
        })
        .where(
          and(
            isNull(pluginInstances.tenantId),
            eq(pluginInstances.capability, "sms"),
            eq(pluginInstances.vendor, vendor),
            eq(pluginInstances.mode, mode),
          ),
        );
    } catch {
      // Observability, not correctness. Swallowing here is deliberate and bounded.
    }
  }
}

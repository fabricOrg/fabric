import type { PluginInstanceDto } from "@app/contracts";
import {
  type NewPluginInstance,
  type ProvisioningDb,
  pluginInstances,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

/**
 * Platform plugin registry (docs/PI-5/PLUGIN-REGISTRY.md). plugin_instances is GLOBAL config (no
 * tenant/RLS) — staff-managed via the control plane. `resolve()` is the shared selection/failover
 * mechanism callers use (primary first, then fallbacks). Going live is a redline handled elsewhere.
 */
const CATALOG: NewPluginInstance[] = [
  {
    capability: "sms",
    vendor: "fakeprovider",
    label: "FakeProvider",
    enabled: true,
    isDefault: true,
    mode: "sandbox",
    status: "connected",
    priority: 0,
  },
  {
    capability: "sms",
    vendor: "africas-talking",
    label: "Africa's Talking",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "sms",
    vendor: "hubtel",
    label: "Hubtel",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "whatsapp",
    vendor: "meta-cloud",
    label: "WhatsApp Business Cloud",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "payment",
    vendor: "paystack",
    label: "Paystack",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 0,
  },
  {
    capability: "payment",
    vendor: "flutterwave",
    label: "Flutterwave",
    enabled: false,
    isDefault: false,
    mode: "sandbox",
    status: "available",
    priority: 100,
  },
  {
    capability: "identity",
    vendor: "workos",
    label: "WorkOS AuthKit",
    enabled: true,
    isDefault: true,
    mode: "sandbox",
    status: "connected",
    priority: 0,
  },
];

type Row = typeof pluginInstances.$inferSelect;

function toDto(row: Row): PluginInstanceDto {
  return {
    id: row.id,
    capability: row.capability,
    vendor: row.vendor,
    label: row.label,
    enabled: row.enabled,
    isDefault: row.isDefault,
    status: row.status,
    mode: row.mode,
  };
}

@Injectable()
export class PluginRegistryService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  /** Idempotently seed the platform provider catalog (first run leaves the table populated). */
  private async ensureCatalog(): Promise<void> {
    await this.provisioning.db
      .insert(pluginInstances)
      .values(CATALOG)
      .onConflictDoNothing({
        target: [pluginInstances.capability, pluginInstances.vendor],
      });
  }

  async list(): Promise<PluginInstanceDto[]> {
    await this.ensureCatalog();
    const rows = await this.provisioning.db
      .select()
      .from(pluginInstances)
      .orderBy(asc(pluginInstances.capability), asc(pluginInstances.priority));
    return rows.map(toDto);
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
    return rows.map(toDto);
  }

  async apply(
    id: string,
    action: "enable" | "disable" | "make-default",
  ): Promise<PluginInstanceDto | null> {
    return this.provisioning.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(pluginInstances)
        .where(eq(pluginInstances.id, id))
        .limit(1);
      if (!current) return null;

      if (action === "make-default") {
        // Demote the current primary in this capability, then promote this instance.
        await tx
          .update(pluginInstances)
          .set({ isDefault: false, priority: 100, updatedAt: new Date() })
          .where(eq(pluginInstances.capability, current.capability));
        await tx
          .update(pluginInstances)
          .set({
            isDefault: true,
            enabled: true,
            status: "connected",
            priority: 0,
            updatedAt: new Date(),
          })
          .where(eq(pluginInstances.id, id));
      } else {
        const enabled = action === "enable";
        await tx
          .update(pluginInstances)
          .set({
            enabled,
            status: enabled ? "connected" : "available",
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
      return updated ? toDto(updated) : null;
    });
  }
}

import { createProvisioningDb, pluginInstances } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { PluginCredentialsService } from "./plugin-credentials.service.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginResolverService } from "./plugin-resolver.service.js";

// Runs only when a real DB is configured (local docker / CI ephemeral); skipped otherwise.
const superUrl = process.env.DATABASE_URL_SUPER;
const describeDb = superUrl ? describe : describe.skip;

const MASTER_KEY = "test-plugin-master-key-at-least-32-chars-long";
const ARKESEL_KEY = "ark_live_secret_value_do_not_log";

/** Both services must derive the SAME key from this, or a sealed credential cannot be reopened. */
const config = {
  get: (key: string) =>
    key === "PLUGIN_MASTER_KEY" ? MASTER_KEY : process.env[key],
} as unknown as ConfigService;

const audit = {
  record: async () => undefined,
} as unknown as AuditService;

describeDb("plugin credentials → resolution (ADR-0011 slices 1+2+4)", () => {
  const db = createProvisioningDb(superUrl ?? "", { max: 2 });
  const registry = new PluginRegistryService(db);
  const credentials = new PluginCredentialsService(db, config, audit);
  const resolver = new PluginResolverService(db, config);

  beforeAll(async () => {
    await db.db.delete(pluginInstances);
    await registry.list(); // seeds the catalog
  });
  afterAll(async () => {
    await db.db.delete(pluginInstances);
    await db.end();
  });

  it("refuses to activate live without installed credentials", async () => {
    const live = await registry.createLiveInstance({
      vendor: "arkesel",
      capability: "sms",
    });
    expect(live.mode).toBe("live");
    expect(live.enabled).toBe(false);
    expect(live.credential_fingerprint).toBeNull();

    // The §5 gate: enabled + live + no key resolves to a provider that fails every send.
    await expect(registry.apply(live.id, "activate-live")).rejects.toSatisfy(
      (error: unknown) =>
        (
          error as { getResponse?: () => { error?: { code?: string } } }
        ).getResponse?.()?.error?.code === "credentials_required",
    );
  });

  it("rejects a credential missing a field the adapter declares required", async () => {
    const live = await registry.createLiveInstance({
      vendor: "arkesel",
      capability: "sms",
    });
    await expect(
      credentials.configure(
        live.id,
        { credential: { sandbox: "false" } }, // no apiKey
        { email: "ops@fabric.dev" },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        (
          error as { getResponse?: () => { error?: { code?: string } } }
        ).getResponse?.()?.error?.code === "missing_credential_field",
    );
  });

  /**
   * The whole point of ADR-0011, end to end: a key installed through the control plane is sealed at
   * rest, and the SEND PATH resolves it back — no redeploy, no env var. If this passes, adding a
   * carrier is a staff action.
   */
  it("installs a credential, activates live, and the send path resolves it back", async () => {
    const live = await registry.createLiveInstance({
      vendor: "arkesel",
      capability: "sms",
    });
    const installed = await credentials.configure(
      live.id,
      { credential: { apiKey: ARKESEL_KEY, sandbox: "false" } },
      { email: "ops@fabric.dev" },
    );
    expect(installed.version).toBe(1);
    expect(installed.fingerprint).toHaveLength(12);

    const activated = await registry.apply(live.id, "activate-live");
    expect(activated?.enabled).toBe(true);
    // §6: activation is NOT evidence we reached the vendor. Status stays unearned.
    expect(activated?.status).toBe("available");

    const resolved = await resolver.resolveSms("live");
    expect(resolved?.vendor).toBe("arkesel");
    expect(resolved?.provider.slug).toBe("arkesel-sms");
    // Decrypted back through the envelope — this is what a live send would actually use.
    expect(resolved?.creds.apiKey).toBe(ARKESEL_KEY);
    expect(resolved?.creds.sandbox).toBe("false");
  });

  it("never exposes the secret through a read — fingerprint only", async () => {
    const listed = await registry.list();
    const live = listed.find(
      (i) => i.vendor === "arkesel" && i.mode === "live",
    );
    expect(live?.credential_fingerprint).toHaveLength(12);
    // The secret must not appear anywhere in the serialized read surface.
    expect(JSON.stringify(listed)).not.toContain(ARKESEL_KEY);
  });

  it("rotation supersedes the old version and the new key is what resolves", async () => {
    const listed = await registry.list();
    const live = listed.find(
      (i) => i.vendor === "arkesel" && i.mode === "live",
    );
    if (!live) throw new Error("expected a live arkesel instance");

    const rotated = await credentials.configure(
      live.id,
      { credential: { apiKey: "ark_rotated_key", sandbox: "false" } },
      { email: "ops@fabric.dev" },
    );
    expect(rotated.version).toBe(2);

    resolver.invalidate(); // the send path caches for 30s; a rotation must take effect
    const resolved = await resolver.resolveSms("live");
    expect(resolved?.creds.apiKey).toBe("ark_rotated_key");
  });
});

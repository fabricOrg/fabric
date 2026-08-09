import { createProvisioningDb, pluginInstances } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { assertDisposablePluginCatalog } from "../testing/disposable-plugin-catalog.js";
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
    await assertDisposablePluginCatalog(db);
    await db.db.delete(pluginInstances);
    await registry.list(); // seeds the catalog
  });
  afterAll(async () => {
    // Same reason as the registry spec: the beforeAll guard proves the catalog was disposable when this
    // spec started, not when a parallel suite finished. An unguarded teardown delete is what actually
    // destroys a credential — the ciphertext is the only copy, so refuse and leave the table dirty.
    await assertDisposablePluginCatalog(db);
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

  /**
   * The requirement that drove payments into the plugin system: a sandbox workspace must charge with
   * TEST keys and a live one with LIVE keys. Slice 3 made them separate rows, so this is isolation by
   * construction rather than a flag someone can get wrong — and it proves the resolver treats
   * payments exactly as it treats SMS.
   */
  it("resolves payment credentials per mode — sandbox gets test keys, live gets live keys", async () => {
    const sandbox = (await registry.list()).find(
      (i) => i.vendor === "paystack" && i.mode === "sandbox",
    );
    if (!sandbox)
      throw new Error("expected a seeded sandbox paystack instance");
    const live = await registry.createLiveInstance({
      vendor: "paystack",
      capability: "payment",
    });

    await credentials.configure(
      sandbox.id,
      { credential: { secretKey: "sk_test_sandbox_key" } },
      { email: "ops@fabric.dev" },
    );
    await credentials.configure(
      live.id,
      { credential: { secretKey: "sk_live_real_key" } },
      { email: "ops@fabric.dev" },
    );
    await registry.apply(sandbox.id, "enable");
    await registry.apply(live.id, "activate-live");

    try {
      resolver.invalidate();
      const resolvedSandbox = await resolver.resolvePayment("sandbox");
      const resolvedLive = await resolver.resolvePayment("live");
      expect(resolvedSandbox?.creds.secretKey).toBe("sk_test_sandbox_key");
      expect(resolvedLive?.creds.secretKey).toBe("sk_live_real_key");
      expect(resolvedSandbox?.provider.slug).toBe("paystack");
      expect(resolvedLive?.provider.slug).toBe("paystack");
    } finally {
      // plugin_instances is GLOBAL control-plane config with no tenant scoping, and integration
      // specs share one database — so an ENABLED payment instance changes resolution for every
      // other spec running concurrently. Leaving these on made flows' Lighthouse saga resolve this
      // fake key and make a real Paystack call ("Invalid key"). Disable inside the test rather than
      // in afterAll, and never leave shared global state enabled.
      await registry.apply(sandbox.id, "disable");
      await registry.apply(live.id, "disable");
      resolver.invalidate();
    }
  });

  // Paystack's adapter requires `secretKey`. Before configure() validated non-SMS capabilities this
  // stored happily under the wrong field name and failed only at charge time.
  it("rejects a payment credential using the wrong field name", async () => {
    const live = await registry.createLiveInstance({
      vendor: "paystack",
      capability: "payment",
    });
    await expect(
      credentials.configure(
        live.id,
        { credential: { apiKey: "sk_live_wrong_field" } },
        { email: "ops@fabric.dev" },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        (
          error as { getResponse?: () => { error?: { code?: string } } }
        ).getResponse?.()?.error?.code === "missing_credential_field",
    );
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

    try {
      resolver.invalidate(); // the send path caches for 30s; a rotation must take effect
      const resolved = await resolver.resolveSms("live");
      expect(resolved?.creds.apiKey).toBe("ark_rotated_key");
    } finally {
      // Same shared-global-state hazard as the payment test above: an enabled LIVE sms instance
      // makes every concurrently-running send spec resolve this fake Arkesel key and attempt a real
      // carrier call. This is the last test that needs it enabled, so switch it off here rather than
      // relying on afterAll.
      await registry.apply(live.id, "disable");
      resolver.invalidate();
    }
  });
});

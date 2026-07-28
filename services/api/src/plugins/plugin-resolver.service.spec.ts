import { createHash } from "node:crypto";
import {
  encryptCredential,
  newCredentialDek,
  wrapCredentialDek,
} from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { PluginResolverService } from "./plugin-resolver.service.js";

/**
 * The resolver decides what actually dispatches a message. Its failure behaviour is the point: a
 * wrong answer here either sends nothing while reporting success, or refuses a send that should
 * have gone. Both are worse than a slow query.
 */
const MASTER = "plugin-master-key-at-least-32-characters";
const INSTANCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function config(
  values: Record<string, string | undefined> = {},
): ConfigService {
  return {
    get: (key: string) => values[key] ?? { PLUGIN_MASTER_KEY: MASTER }[key],
  } as unknown as ConfigService;
}

/** A provisioning stand-in whose drizzle chain returns whatever rows the test supplies. */
function provisioning(plan: {
  instances?: unknown[];
  credential?: unknown[];
  throws?: Error;
}) {
  let call = 0;
  // orderBy/limit are the TERMINAL calls the resolver awaits, so they return the promise; the
  // intermediate builders just return themselves. No thenable object needed.
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
    };
    self.from = () => self;
    self.where = () => self;
    return self;
  };
  return {
    db: {
      select: () => {
        if (plan.throws) throw plan.throws;
        call += 1;
        return chain(
          call === 1 ? (plan.instances ?? []) : (plan.credential ?? []),
        );
      },
    },
  } as never;
}

function sealedCredential(secret: string, version = 1) {
  const dek = newCredentialDek();
  const masterKey = createHash("sha256")
    .update(`plugin-master:${MASTER}`)
    .digest();
  return {
    id: "cred-1",
    version,
    dekWrapped: wrapCredentialDek(masterKey, dek, INSTANCE, version),
    ciphertext: encryptCredential(dek, { apiKey: secret }, INSTANCE, version),
    fingerprint: "abc123",
  };
}

describe("PluginResolverService", () => {
  it("resolves the enabled instance and decrypts its credential", async () => {
    const resolver = new PluginResolverService(
      provisioning({
        instances: [
          { id: INSTANCE, vendor: "arkesel", credentialsRef: "cred-1" },
        ],
        credential: [sealedCredential("sk_live_secret")],
      }),
      config(),
    );
    const resolved = await resolver.resolveSms("live");
    expect(resolved?.vendor).toBe("arkesel");
    expect(resolved?.creds).toEqual({ apiKey: "sk_live_secret" });
  });

  it("returns null when nothing is enabled — never a fallback provider", async () => {
    // "Cannot send" must not quietly become "sent via something else". A fake fallback would report
    // accepted for a message that never left the building.
    const resolver = new PluginResolverService(
      provisioning({ instances: [] }),
      config(),
    );
    expect(await resolver.resolveSms("live")).toBeNull();
  });

  it("skips a vendor this build has no adapter for", async () => {
    // A catalog row staff enabled for a carrier we cannot dispatch must not block a working one.
    const resolver = new PluginResolverService(
      provisioning({
        instances: [
          { id: INSTANCE, vendor: "not-implemented", credentialsRef: "cred-1" },
        ],
      }),
      config(),
    );
    expect(await resolver.resolveSms("live")).toBeNull();
  });

  it("skips an instance whose credential is revoked", async () => {
    // dek_wrapped NULL is deliberate revocation, not corruption — a normal state to skip.
    const resolver = new PluginResolverService(
      provisioning({
        instances: [
          { id: INSTANCE, vendor: "arkesel", credentialsRef: "cred-1" },
        ],
        credential: [{ ...sealedCredential("x"), dekWrapped: null }],
      }),
      config(),
    );
    expect(await resolver.resolveSms("live")).toBeNull();
  });

  it("skips an instance with no credential configured", async () => {
    const resolver = new PluginResolverService(
      provisioning({
        instances: [{ id: INSTANCE, vendor: "arkesel", credentialsRef: null }],
      }),
      config(),
    );
    expect(await resolver.resolveSms("live")).toBeNull();
  });

  it("fails closed when the control plane is unreachable and nothing is cached", async () => {
    // The whole point. Refusing is recoverable; fabricating a send is not.
    const resolver = new PluginResolverService(
      provisioning({ throws: new Error("control-plane db down") }),
      config(),
    );
    await expect(resolver.resolveSms("live")).rejects.toThrow(
      "control-plane db down",
    );
  });

  it("caches, so a burst of sends costs one control-plane read", async () => {
    let selects = 0;
    const counting = {
      db: {
        select: () => {
          selects += 1;
          const self: Record<string, unknown> = {
            orderBy: () => Promise.resolve([]),
            limit: () => Promise.resolve([]),
          };
          self.from = () => self;
          self.where = () => self;
          return self;
        },
      },
    } as never;
    const resolver = new PluginResolverService(counting, config());
    await resolver.resolveSms("live");
    await resolver.resolveSms("live");
    await resolver.resolveSms("live");
    expect(selects).toBe(1);
  });

  it("re-reads after invalidate, so a control-plane change takes effect at once", async () => {
    let selects = 0;
    const counting = {
      db: {
        select: () => {
          selects += 1;
          const self: Record<string, unknown> = {
            orderBy: () => Promise.resolve([]),
            limit: () => Promise.resolve([]),
          };
          self.from = () => self;
          self.where = () => self;
          return self;
        },
      },
    } as never;
    const resolver = new PluginResolverService(counting, config());
    await resolver.resolveSms("live");
    resolver.invalidate();
    await resolver.resolveSms("live");
    expect(selects).toBe(2);
  });

  it("refuses to boot production without a master key", async () => {
    // A development fallback key in production would make every stored vendor credential readable
    // by anyone holding this source.
    const resolver = new PluginResolverService(
      provisioning({
        instances: [
          { id: INSTANCE, vendor: "arkesel", credentialsRef: "cred-1" },
        ],
      }),
      config({ PLUGIN_MASTER_KEY: "", NODE_ENV: "production" }),
    );
    await expect(resolver.resolveSms("live")).rejects.toThrow(
      "PLUGIN_MASTER_KEY",
    );
  });
});

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sealEnvelope } from "./pii-envelope.js";
import {
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
  newCredentialDek,
  unwrapCredentialDek,
  wrapCredentialDek,
} from "./plugin-envelope.js";

/**
 * These functions guard vendor API keys. The negative cases are the point: a ciphertext that
 * decrypts under the WRONG instance or the WRONG version would let a revoked or foreign credential
 * be replayed, which is the failure this envelope exists to prevent.
 */
const MASTER = randomBytes(32);
const INSTANCE = "11111111-1111-4111-8111-111111111111";
const OTHER_INSTANCE = "22222222-2222-4222-8222-222222222222";

describe("plugin credential envelope", () => {
  it("round-trips a credential document", () => {
    const dek = newCredentialDek();
    const sealed = encryptCredential(
      dek,
      { apiKey: "sk_live_abc" },
      INSTANCE,
      1,
    );
    expect(decryptCredential(dek, sealed, INSTANCE, 1)).toEqual({
      apiKey: "sk_live_abc",
    });
  });

  it("round-trips the wrapped DEK under the master key", () => {
    const dek = newCredentialDek();
    const wrapped = wrapCredentialDek(MASTER, dek, INSTANCE, 1);
    expect(unwrapCredentialDek(MASTER, wrapped, INSTANCE, 1)).toEqual(dek);
  });

  it("never stores the secret in the sealed bytes", () => {
    const dek = newCredentialDek();
    const sealed = encryptCredential(
      dek,
      { apiKey: "sk_live_abc" },
      INSTANCE,
      1,
    );
    expect(sealed.toString("utf8")).not.toContain("sk_live_abc");
    expect(sealed.toString("hex")).not.toContain(
      Buffer.from("sk_live_abc").toString("hex"),
    );
  });

  it("refuses a credential lifted into another instance", () => {
    // The AAD binds instance identity: copying one row's ciphertext onto another instance must not
    // yield a working credential.
    const dek = newCredentialDek();
    const sealed = encryptCredential(
      dek,
      { apiKey: "sk_live_abc" },
      INSTANCE,
      1,
    );
    expect(() => decryptCredential(dek, sealed, OTHER_INSTANCE, 1)).toThrow();
  });

  it("refuses a superseded version replayed against a newer record", () => {
    // Rotation keeps the old row. Without version in the AAD, yesterday's revoked key would still
    // decrypt as today's.
    const dek = newCredentialDek();
    const sealed = encryptCredential(dek, { apiKey: "old" }, INSTANCE, 1);
    expect(() => decryptCredential(dek, sealed, INSTANCE, 2)).toThrow();
  });

  it("refuses a DEK unwrapped for the wrong instance or version", () => {
    const dek = newCredentialDek();
    const wrapped = wrapCredentialDek(MASTER, dek, INSTANCE, 1);
    expect(() =>
      unwrapCredentialDek(MASTER, wrapped, OTHER_INSTANCE, 1),
    ).toThrow();
    expect(() => unwrapCredentialDek(MASTER, wrapped, INSTANCE, 2)).toThrow();
  });

  it("refuses a DEK unwrapped under a different master key", () => {
    const dek = newCredentialDek();
    const wrapped = wrapCredentialDek(MASTER, dek, INSTANCE, 1);
    expect(() =>
      unwrapCredentialDek(randomBytes(32), wrapped, INSTANCE, 1),
    ).toThrow();
  });

  it("detects tampering with the ciphertext", () => {
    // AES-GCM authenticates: a flipped byte must fail rather than decrypt to garbage.
    const dek = newCredentialDek();
    const sealed = encryptCredential(
      dek,
      { apiKey: "sk_live_abc" },
      INSTANCE,
      1,
    );
    const tampered = Buffer.from(sealed);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => decryptCredential(dek, tampered, INSTANCE, 1)).toThrow();
  });

  it("rejects a decrypted payload that is not a credential object", () => {
    // Seal a JSON ARRAY through the same key and AAD, so it decrypts cleanly and only the shape
    // guard can catch it. Without that guard an array would flow on as a credential and reach an
    // adapter as `creds[0]`-shaped nonsense.
    const dek = newCredentialDek();
    const sealed = sealEnvelope(
      dek,
      Buffer.from(JSON.stringify(["not", "an", "object"]), "utf8"),
      `plugin:cred:${INSTANCE}:v1`,
    );
    expect(() => decryptCredential(dek, sealed, INSTANCE, 1)).toThrow(
      "Malformed plugin credential payload.",
    );
  });
});

describe("credentialFingerprint", () => {
  it("is stable for the same secret", () => {
    expect(credentialFingerprint("sk_live_abc")).toBe(
      credentialFingerprint("sk_live_abc"),
    );
  });

  it("differs for different secrets", () => {
    expect(credentialFingerprint("sk_live_abc")).not.toBe(
      credentialFingerprint("sk_live_abd"),
    );
  });

  it("does not leak the secret", () => {
    // Deliberately not the last-N characters: on a short key that is a meaningful fraction of the
    // material, and this value is shown in the admin console.
    const fp = credentialFingerprint("sk_live_abcdef");
    expect(fp).not.toContain("abcdef");
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });
});

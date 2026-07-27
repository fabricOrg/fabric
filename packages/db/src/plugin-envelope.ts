import { createHash } from "node:crypto";
import { newDek, openEnvelope, sealEnvelope } from "./pii-envelope.js";

/**
 * Envelope encryption for PLUGIN CREDENTIALS (ADR-0011) — the API keys and secrets that let us talk
 * to a carrier, a payment processor, or an email sender.
 *
 * Same two-level shape as the PII vault, and for the same reason: a per-credential DEK is wrapped
 * under the platform master key, and the secret itself is never encrypted directly under the master
 * key. Destroying one wrapped DEK revokes exactly one credential — rotating or pulling a single
 * provider must not require re-encrypting everything else.
 *
 * The AAD binds the ciphertext to its plugin instance AND its version, so a credential lifted from
 * one instance's row cannot be pasted into another's and still decrypt. Version is in there because
 * rotation keeps the superseded row around: without it, an old ciphertext would remain valid under
 * the new record.
 *
 * Reuses the ONE envelope implementation in pii-envelope.ts. A second AEAD here would drift.
 *
 * Pure functions — no db, no config. The service owns where the master key comes from.
 */

/** Wrap a credential's DEK under the platform master key, bound to its instance + version. */
export function wrapCredentialDek(
  masterKey: Buffer,
  dek: Buffer,
  instanceId: string,
  version: number,
): Buffer {
  return sealEnvelope(
    masterKey,
    dek,
    credentialAad("dek", instanceId, version),
  );
}

export function unwrapCredentialDek(
  masterKey: Buffer,
  wrapped: Buffer,
  instanceId: string,
  version: number,
): Buffer {
  return openEnvelope(
    masterKey,
    wrapped,
    credentialAad("dek", instanceId, version),
  );
}

/**
 * Encrypt a credential document — the whole `{ apiKey, sandbox, … }` object an adapter expects, as
 * JSON — under its own DEK. One blob rather than a column per field: adapters declare their own
 * shapes via `configSchema`, and a schema-per-vendor table would need a migration per carrier.
 */
export function encryptCredential(
  dek: Buffer,
  credential: Record<string, string>,
  instanceId: string,
  version: number,
): Buffer {
  return sealEnvelope(
    dek,
    Buffer.from(JSON.stringify(credential), "utf8"),
    credentialAad("cred", instanceId, version),
  );
}

export function decryptCredential(
  dek: Buffer,
  ciphertext: Buffer,
  instanceId: string,
  version: number,
): Record<string, string> {
  const json = openEnvelope(
    dek,
    ciphertext,
    credentialAad("cred", instanceId, version),
  ).toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed plugin credential payload.");
  }
  return parsed as Record<string, string>;
}

/** Generate a fresh DEK for a new credential version. Re-exported so callers need one import. */
export { newDek as newCredentialDek };

/**
 * A non-reversible marker staff can use to confirm WHICH key is installed without being able to
 * read it — shown wherever a credential would otherwise be displayed.
 *
 * Deliberately NOT the secret's last characters: for short keys that leaks a meaningful fraction of
 * the material. A truncated salted digest identifies a value (two installs of the same key match)
 * while revealing none of it.
 */
export function credentialFingerprint(secret: string): string {
  return createHash("sha256")
    .update(`fabric:plugin-credential:${secret}`, "utf8")
    .digest("hex")
    .slice(0, 12);
}

function credentialAad(
  kind: "dek" | "cred",
  instanceId: string,
  version: number,
): string {
  return `plugin:${kind}:${instanceId}:v${version}`;
}

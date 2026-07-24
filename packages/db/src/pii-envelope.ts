import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

/**
 * Envelope encryption for the PII vault (COMPLIANCE §5).
 *
 * Two levels, and the distinction is the whole point:
 *   - a per-SUBJECT Data Encryption Key (DEK) encrypts that person's PII;
 *   - the MASTER key encrypts ("wraps") the DEK, and never touches plaintext PII itself.
 *
 * Erasure = destroy the wrapped DEK. One row goes NULL and every piece of that subject's PII becomes
 * permanently unreadable, while the ledger, audit, and message history keep their surrogates and
 * amounts. That is why PII must never be encrypted directly under the master key: a platform-wide
 * key cannot be destroyed for one person.
 *
 * AEAD everywhere (AES-256-GCM) with the context bound into the AAD, so a ciphertext lifted from one
 * subject/tenant/kind cannot be pasted into another and still decrypt.
 *
 * Pure functions — no db, no config. The service owns where keys come from; this owns the maths.
 *
 * Lives in @app/db so there is exactly ONE implementation of the envelope. The one-off backfill
 * (cloud-backfill-pii-vault.ts) and the api's PiiVaultService both seal PII, and a divergence between
 * two hand-rolled copies would corrupt irreplaceable personal data SILENTLY — rows written by one
 * that the other cannot decrypt. services/api re-exports this rather than reimplementing it.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
export const DEK_BYTES = 32;

/** A wrapped DEK, or any vault ciphertext: iv ‖ authTag ‖ ciphertext, packed for a `bytea` column. */
function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < IV_BYTES + 16) {
    throw new Error("Malformed vault ciphertext.");
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + 16);
  const body = sealed.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function newDek(): Buffer {
  return randomBytes(DEK_BYTES);
}

/** Wrap a subject's DEK under the master key. AAD binds it to the tenant + subject it belongs to. */
export function wrapDek(
  masterKey: Buffer,
  dek: Buffer,
  tenantId: string,
  subjectId: string,
): Buffer {
  return seal(masterKey, dek, `dek:${tenantId}:${subjectId}`);
}

export function unwrapDek(
  masterKey: Buffer,
  wrapped: Buffer,
  tenantId: string,
  subjectId: string,
): Buffer {
  return open(masterKey, wrapped, `dek:${tenantId}:${subjectId}`);
}

/** Encrypt one piece of PII under the subject's DEK. AAD binds tenant + subject + kind. */
export function encryptPii(
  dek: Buffer,
  value: string,
  tenantId: string,
  subjectId: string,
  kind: string,
): Buffer {
  return seal(
    dek,
    Buffer.from(value, "utf8"),
    `${tenantId}:${subjectId}:${kind}`,
  );
}

export function decryptPii(
  dek: Buffer,
  ciphertext: Buffer,
  tenantId: string,
  subjectId: string,
  kind: string,
): string {
  return open(dek, ciphertext, `${tenantId}:${subjectId}:${kind}`).toString(
    "utf8",
  );
}

/**
 * Blind index over a phone number: lets us find an existing subject without decrypting anything, and
 * without storing the number. Keyed HMAC, not a bare hash — a bare SHA-256 of an E.164 number is
 * trivially reversible by enumerating the (small) national number space.
 *
 * Deliberately tenant-scoped: the same number under two tenants yields two different subjects, so
 * one tenant can never probe another's recipient list, and RLS stays the isolation boundary.
 */
export function phoneBlindIndex(
  indexKey: Buffer,
  tenantId: string,
  e164: string,
): string {
  return createHmac("sha256", indexKey)
    .update(`${tenantId}:${normalizeE164(e164)}`)
    .digest("hex");
}

/** Tenant-scoped blind index for a normalized email address. */
export function emailBlindIndex(
  indexKey: Buffer,
  tenantId: string,
  email: string,
): string {
  return createHmac("sha256", indexKey)
    .update(`${tenantId}:${email.trim().toLowerCase()}`)
    .digest("hex");
}

/** Strip spaces/dashes/parens so the same human number always lands on the same subject. */
export function normalizeE164(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

/** Display form — the vault holds the truth; this is what a UI may show without unsealing. */
export function maskMsisdn(e164: string): string {
  const n = normalizeE164(e164);
  if (n.length <= 9) return `${n.slice(0, 3)}•••`;
  return `${n.slice(0, 6)}•••${n.slice(-4)}`;
}

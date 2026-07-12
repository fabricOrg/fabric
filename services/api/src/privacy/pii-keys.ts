import { createHash } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { decryptPii, unwrapDek } from "./pii-crypto.js";

/**
 * Key custody + row unsealing for the PII vault.
 *
 * Custody is deliberately isolated here: the master key is read in exactly one place, so moving from
 * a Secrets Manager value to a KMS-held key later touches this file and nothing above it. Nothing in
 * the service ever sees the raw secret.
 */

type Row = Record<string, unknown>;

/**
 * The master key wraps DEKs; the index key keys the phone blind index. They are DERIVED from one
 * secret but must never be the same bytes — an index key that doubles as an encryption key means a
 * leak of one is a leak of both.
 *
 * Production refuses to start without a real secret. A default key would silently make every
 * ciphertext readable by anyone holding the source, which is worse than not booting.
 */
function derive(config: ConfigService, purpose: "master" | "index"): Buffer {
  const secret = config.get<string>("PII_MASTER_KEY");
  if (!secret || secret.length < 32) {
    if (config.get<string>("NODE_ENV") === "production") {
      throw new Error(
        "PII_MASTER_KEY must be set to at least 32 characters in production.",
      );
    }
    return createHash("sha256")
      .update(`fabric-local-pii-development-key:${purpose}`)
      .digest();
  }
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function masterKeyFrom(config: ConfigService): Buffer {
  return derive(config, "master");
}

export function indexKeyFrom(config: ConfigService): Buffer {
  return derive(config, "index");
}

/**
 * Unseal one joined `pii_vault` + `dek_keys` row.
 *
 * Returns null in BOTH the erased case (DEK destroyed) and the unreadable case (corrupt row, wrong
 * key). The caller cannot act differently on those anyway — the data is gone either way — and a
 * single bad row must never take down the surface reading it.
 */
export function unsealRow(
  masterKey: Buffer,
  tenantId: string,
  row: Row,
): string | null {
  if (row.status !== "active" || !row.wrapped_dek) return null;
  const subjectId = String(row.subject_id);
  try {
    const dek = unwrapDek(
      masterKey,
      toBuffer(row.wrapped_dek),
      tenantId,
      subjectId,
    );
    return decryptPii(
      dek,
      toBuffer(row.ciphertext),
      tenantId,
      subjectId,
      String(row.kind),
    );
  } catch {
    return null;
  }
}

export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error("Expected bytea column to arrive as binary.");
}

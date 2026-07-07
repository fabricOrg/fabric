import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { ImpersonationClaim } from "./index.js";

/**
 * Seal a time-boxed staff impersonation claim into a cookie the browser can't read or alter (AES-256-
 * GCM, same construction as the development session). Staff-only, short TTL; the never-silent banner
 * reads it back and the window auto-expires. Fails closed on tamper/expiry.
 */
const VERSION = "imp1";
const KEY_SALT = "fabric-impersonation";

function keyFrom(password: string): Buffer {
  if (password.length < 32) {
    throw new Error("Impersonation cookie password must be ≥ 32 characters.");
  }
  return scryptSync(password, KEY_SALT, 32);
}

export function sealImpersonation(
  password: string,
  claim: ImpersonationClaim,
): string {
  const key = keyFrom(password);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(claim), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, encrypted, tag]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function readImpersonation(
  password: string,
  sealed: string | undefined,
  now = Date.now(),
): ImpersonationClaim | null {
  try {
    if (!sealed) return null;
    const [version, ivRaw, encryptedRaw, tagRaw] = sealed.split(".");
    if (version !== VERSION || !ivRaw || !encryptedRaw || !tagRaw) return null;
    const key = keyFrom(password);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivRaw, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const claim = JSON.parse(plaintext) as Partial<ImpersonationClaim>;
    if (
      typeof claim.targetTenantId !== "string" ||
      typeof claim.expiresAt !== "number" ||
      typeof claim.reason !== "string" ||
      claim.expiresAt <= now
    ) {
      return null;
    }
    return claim as ImpersonationClaim;
  } catch {
    return null;
  }
}

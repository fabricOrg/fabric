import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { AppSession } from "./index.js";

export interface DevelopmentSessionConfig {
  enabled: boolean;
  runtime: "development" | "test" | "production";
  cookiePassword: string;
  ttlSeconds?: number;
}

interface SessionPayload {
  session: AppSession;
  expiresAt: number;
}

const VERSION = "v1";
const KEY_SALT = "fabric-development-session";

function assertEnabled(config: DevelopmentSessionConfig): void {
  if (!config.enabled || config.runtime === "production") {
    throw new Error("Development authentication is disabled.");
  }
  if (config.cookiePassword.length < 32) {
    throw new Error(
      "Development session password must be at least 32 characters.",
    );
  }
}

/** Seal local claims so the browser cannot read or alter tenant identity. */
export function sealDevelopmentSession(
  config: DevelopmentSessionConfig,
  session: AppSession,
  now = Date.now(),
): string {
  assertEnabled(config);
  const key = scryptSync(config.cookiePassword, KEY_SALT, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload: SessionPayload = {
    session,
    expiresAt: now + (config.ttlSeconds ?? 8 * 60 * 60) * 1000,
  };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, encrypted, tag]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

/** Fail closed for malformed, tampered, expired, disabled, or production local sessions. */
export function readDevelopmentSession(
  config: DevelopmentSessionConfig,
  sealed: string | undefined,
  now = Date.now(),
): AppSession | null {
  try {
    assertEnabled(config);
    if (!sealed) return null;
    const [version, ivRaw, encryptedRaw, tagRaw] = sealed.split(".");
    if (version !== VERSION || !ivRaw || !encryptedRaw || !tagRaw) {
      return null;
    }
    const key = scryptSync(config.cookiePassword, KEY_SALT, 32);
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
    const payload = JSON.parse(plaintext) as Partial<SessionPayload>;
    if (
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now ||
      !isAppSession(payload.session)
    ) {
      return null;
    }
    return payload.session;
  } catch {
    return null;
  }
}

function isAppSession(value: unknown): value is AppSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AppSession>;
  return (
    typeof session.userId === "string" &&
    typeof session.orgId === "string" &&
    typeof session.role === "string" &&
    Array.isArray(session.permissions) &&
    session.permissions.every((permission) => typeof permission === "string") &&
    typeof session.sessionId === "string"
  );
}

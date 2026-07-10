import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { secretsMatch } from "../http/shared-secret.js";

/** ADR-0003: short-lived BFF data-plane credential — `bfft_<payload>.<sig>`, HMAC-SHA256. */
export const TENANT_TOKEN_PREFIX = "bfft_";
const TOKEN_TTL_SECONDS = 300;

export interface VerifiedTenantToken {
  readonly tenantId: string;
  /** Rate-limit bucket id — derived from the tenant, never from token material. */
  readonly keyId: string;
}

interface TokenPayload {
  readonly t: string;
  readonly exp: number;
}

/**
 * Mints and verifies the BFF's per-tenant tokens (ADR-0003). Fail-closed: with no
 * TENANT_TOKEN_SECRET configured, minting throws and verification rejects — a missing secret
 * must never widen access. The payload carries only tenant id + expiry; user-level
 * authorization stays at the BFF against the resolved membership role.
 */
@Injectable()
export class TenantTokenService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private secret(): string {
    return this.config.get<string>("TENANT_TOKEN_SECRET") ?? "";
  }

  mint(tenantId: string): { token: string; expiresIn: number } {
    const secret = this.secret();
    if (secret.length === 0) {
      throw new Error(
        "TENANT_TOKEN_SECRET is not configured — refusing to mint tenant tokens.",
      );
    }
    const payload: TokenPayload = {
      t: tenantId,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = sign(body, secret);
    return {
      token: `${TENANT_TOKEN_PREFIX}${body}.${signature}`,
      expiresIn: TOKEN_TTL_SECONDS,
    };
  }

  /** Null on any defect (format, signature, expiry) — the guard maps null → 401. */
  verify(raw: string): VerifiedTenantToken | null {
    const secret = this.secret();
    if (secret.length === 0) return null;
    if (!raw.startsWith(TENANT_TOKEN_PREFIX)) return null;
    const [body, signature, ...rest] = raw
      .slice(TENANT_TOKEN_PREFIX.length)
      .split(".");
    if (!body || !signature || rest.length > 0) return null;
    if (!secretsMatch(signature, sign(body, secret))) return null;

    let payload: TokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as TokenPayload;
    } catch {
      return null;
    }
    if (typeof payload.t !== "string" || payload.t.length === 0) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { tenantId: payload.t, keyId: `bfft_${payload.t.slice(0, 12)}` };
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

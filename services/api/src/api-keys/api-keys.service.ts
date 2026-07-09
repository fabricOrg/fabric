import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import {
  type ApiKeyEnv,
  generateApiKey,
  hashApiKey,
  parseApiKeyEnv,
} from "./api-key.crypto.js";

/** What the guard needs after a successful resolve — the tenant + its granted scopes. */
export interface ResolvedApiKey {
  readonly tenantId: string;
  readonly scopes: string[];
  /** Stable per-key identifier for rate-limit buckets: a hash PREFIX, never raw key material. */
  readonly keyId: string;
}

/** A newly created key — the raw secret is present ONCE here and never again. */
export interface CreatedApiKey {
  readonly id: string;
  readonly prefix: string;
  readonly env: ApiKeyEnv;
  readonly scopes: string[];
  readonly raw: string; // show once; never stored, never returned again
}

/** A key as listed to its tenant — never includes the raw key or the hash. */
export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly env: ApiKeyEnv;
  readonly scopes: string[];
  readonly status: "active" | "revoked";
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

/**
 * API-key issuance + resolution (F2.3, L2). The AUTH path (`resolve`) runs through the possession-
 * scoped `withApiKeyLookup` (the ONE pre-tenant lookup); everything else is tenant-scoped via
 * `withTenant`. The raw key is hashed at the edge and only its SHA-256 ever touches the DB.
 */
@Injectable()
export class ApiKeyService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  /**
   * Resolve a presented raw key → its tenant + scopes, or null if malformed / unknown / revoked
   * (the guard maps null → 401). Best-effort-bumps `last_used_at` inside the tenant's own context.
   */
  async resolve(rawKey: string): Promise<ResolvedApiKey | null> {
    if (parseApiKeyEnv(rawKey) === null) return null; // not a sk_test_/sk_live_ key — reject fast
    const keyHash = hashApiKey(rawKey);
    const rows = await this.db.withApiKeyLookup(
      keyHash,
      (tx) =>
        tx`SELECT tenant_id, scopes FROM api_keys WHERE status = 'active'` as Promise<
          Array<{ tenant_id: string; scopes: unknown }>
        >,
    );
    const row = rows[0];
    if (!row) return null; // unknown or revoked → the api_key_auth_lookup policy returned nothing
    const tenantId = String(row.tenant_id);
    void this.touch(tenantId, keyHash); // fire-and-forget; must never fail auth
    // keyId = hash prefix: unique enough to bucket per key, reveals nothing about the raw secret.
    return {
      tenantId,
      scopes: toScopes(row.scopes),
      keyId: keyHash.slice(0, 16),
    };
  }

  /** Bump last_used_at inside the tenant's own context — no RLS bypass (the tenant owns the key). */
  private async touch(tenantId: string, keyHash: string): Promise<void> {
    try {
      await this.db.withTenant(
        tenantId,
        (tx) =>
          tx`UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${keyHash}`,
      );
    } catch {
      // last_used_at is telemetry, not auth — swallow so a bump failure never rejects a valid key.
    }
  }

  /** Mint a key for a tenant. Returns the raw secret ONCE; only the hash + prefix are persisted. */
  async create(
    tenantId: string,
    input: { name?: string; env: ApiKeyEnv; scopes?: string[] },
  ): Promise<CreatedApiKey> {
    const k = generateApiKey(input.env);
    const scopes = input.scopes ?? [];
    const rows = await this.db.withTenant(
      tenantId,
      (tx) =>
        tx`INSERT INTO api_keys (tenant_id, name, prefix, key_hash, env, scopes)
           VALUES (${tenantId}, ${input.name ?? ""}, ${k.prefix}, ${k.keyHash}, ${k.env}, ${JSON.stringify(scopes)}::jsonb)
           RETURNING id` as Promise<Array<{ id: string }>>,
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("api key insert returned no id");
    return { id: String(id), prefix: k.prefix, env: k.env, scopes, raw: k.raw };
  }

  /** List a tenant's keys (never the hash/raw) — RLS scopes this to the caller's tenant. */
  async list(tenantId: string): Promise<ApiKeySummary[]> {
    const rows = await this.db.withTenant(
      tenantId,
      (tx) =>
        tx`SELECT id, name, prefix, env, scopes, status, last_used_at, created_at
           FROM api_keys ORDER BY created_at DESC` as Promise<
          Array<Record<string, unknown>>
        >,
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      prefix: String(r.prefix),
      env: r.env as ApiKeyEnv,
      scopes: toScopes(r.scopes),
      status: r.status === "revoked" ? "revoked" : "active",
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
      createdAt: String(r.created_at),
    }));
  }

  /** Revoke a key (idempotent). RLS ensures a tenant can only revoke its own. Returns rows affected. */
  async revoke(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.db.withTenant(
      tenantId,
      (tx) =>
        tx`UPDATE api_keys SET status = 'revoked', revoked_at = now()
           WHERE id = ${id} AND status = 'active' RETURNING id` as Promise<
          Array<{ id: string }>
        >,
    );
    return rows.length > 0;
  }
}

/** jsonb scopes come back parsed; normalize to a string[] defensively. */
function toScopes(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String) : [];
}

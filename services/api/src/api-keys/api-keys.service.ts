import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
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
  /** ADR-0004: the application-environment this key belongs to (drives provider routing, #8). */
  readonly applicationId: string | null;
  readonly environmentId: string | null;
}

/** A newly created key — the raw secret is present ONCE here and never again. */
export interface CreatedApiKey {
  readonly id: string;
  readonly prefix: string;
  readonly env: ApiKeyEnv;
  readonly scopes: string[];
  readonly raw: string; // show once; never stored, never returned again
  readonly expiresAt: string | null;
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
  readonly expiresAt: string | null;
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
        // An expired key (expires_at in the past) stops authenticating — treated like a revoked key,
        // no status change needed. NULL expires_at = never expires.
        tx`SELECT tenant_id, scopes, application_id, environment_id FROM api_keys
           WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())` as Promise<
          Array<{
            tenant_id: string;
            scopes: unknown;
            application_id: string | null;
            environment_id: string | null;
          }>
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
      applicationId: row.application_id ? String(row.application_id) : null,
      environmentId: row.environment_id ? String(row.environment_id) : null,
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
    input: {
      name?: string;
      env: ApiKeyEnv;
      scopes?: string[];
      applicationId?: string;
      /** Days until the key expires; omitted / ≤0 = never expires. */
      expiresInDays?: number;
    },
  ): Promise<CreatedApiKey> {
    const k = generateApiKey(input.env);
    const scopes = input.scopes ?? [];
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;
    // ADR-0004: a key is minted INTO a specific application's environment. When the caller names an
    // application (the dashboard's app-detail page), mint into IT; otherwise the workspace's
    // `default` app (operator / legacy path). The env is chosen by the requested key type
    // (test -> sandbox, live -> live); the environment row is the single source of truth for whether
    // live keys are allowed — superseding the old accounts.plan check.
    const envType = input.env === "live" ? "live" : "sandbox";
    const id = await this.db.withTenant(tenantId, async (tx) => {
      const envRows = (await (input.applicationId
        ? tx`
        SELECT e.id, e.status
        FROM environments e
        JOIN applications a ON a.id = e.application_id
        WHERE a.tenant_id = ${tenantId} AND a.id = ${input.applicationId} AND e.type = ${envType}
        LIMIT 1`
        : tx`
        SELECT e.id, e.status
        FROM environments e
        JOIN applications a ON a.id = e.application_id
        WHERE a.tenant_id = ${tenantId} AND a.slug = 'default' AND e.type = ${envType}
        LIMIT 1`)) as Array<{ id: string; status: string }>;
      const env = envRows[0];
      if (!env) {
        // A named application that has no such env → the caller referenced an app that isn't in this
        // workspace (RLS already scopes the join). Without one, the default app is missing — a
        // provisioning bug (provisioning + the backfill both create it), so fail loud.
        if (input.applicationId) {
          throw invalidRequest(
            "application_not_found",
            "No such application in this workspace.",
            "application_id",
          );
        }
        throw new Error(
          `workspace ${tenantId} has no default '${envType}' environment`,
        );
      }
      // ADR-0002 F3 gate, now keyed on the environment: live keys only once go-live has unlocked
      // the live environment (status 'active'); a 'locked' live env means no live keys yet.
      if (input.env === "live" && env.status !== "active") {
        throw invalidRequest(
          "sandbox_no_live_keys",
          "Live keys unlock after go-live. Request go-live to enable the live environment.",
          "env",
        );
      }
      const rows = (await tx`
        INSERT INTO api_keys (tenant_id, application_id, environment_id, name, prefix, key_hash, env, scopes, expires_at)
        VALUES (${tenantId}, (SELECT application_id FROM environments WHERE id = ${env.id}), ${env.id}, ${input.name ?? ""}, ${k.prefix}, ${k.keyHash}, ${k.env}, ${JSON.stringify(scopes)}::jsonb, ${expiresAt ? expiresAt.toISOString() : null})
        RETURNING id`) as Array<{ id: string }>;
      return rows[0]?.id;
    });
    if (!id) throw new Error("api key insert returned no id");
    return {
      id: String(id),
      prefix: k.prefix,
      env: k.env,
      scopes,
      raw: k.raw,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    };
  }

  /** List a tenant's keys (never the hash/raw) — RLS scopes to the caller's tenant; an optional
   *  applicationId narrows to a single application (the dashboard's app-detail page). */
  async list(
    tenantId: string,
    applicationId?: string,
  ): Promise<ApiKeySummary[]> {
    const rows = await this.db.withTenant(
      tenantId,
      (tx) =>
        (applicationId
          ? tx`SELECT id, name, prefix, env, scopes, status, last_used_at, created_at, expires_at
             FROM api_keys WHERE application_id = ${applicationId} ORDER BY created_at DESC`
          : tx`SELECT id, name, prefix, env, scopes, status, last_used_at, created_at, expires_at
             FROM api_keys ORDER BY created_at DESC`) as Promise<
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
      expiresAt: r.expires_at ? String(r.expires_at) : null,
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
